using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using RemoteDesktop.Models;
using RemoteDesktop.Services;

namespace RemoteDesktop.Hubs;

// Device-side SignalR hub. The Android agent connects here with a device JWT
// (role "device", obtained from POST /api/agent/connect). One device = one
// connection. The hub:
//   - tracks deviceId ↔ connectionId for the lifetime of the connection
//   - drains the InputRelayService channel for that device and pushes events
//     to the agent via "ReceiveInput"
//   - syncs Online/Offline + last-seen on connect/disconnect
//   - relays WebRTC SDP/ICE between the agent and the bound browser viewer
[Authorize(Roles = "device")]
public class AgentHub(
    DeviceManagerService devices,
    InputRelayService inputRelay,
    SessionService sessions,
    WebRtcSignalingService signaling,
    TurnService turn,
    IHubContext<ControlHub> controlHub,
    IHubContext<AgentHub> agentHub,
    ILogger<AgentHub> log
) : Hub
{
    // deviceId → { ConnectionId, drainCts } so we can tear down the input drain
    // loop when the agent disconnects (and so a reconnect supersedes the old one).
    private static readonly ConcurrentDictionary<Guid, AgentConnection> _connections = new();

    public override async Task OnConnectedAsync()
    {
        var deviceId = GetDeviceIdOrThrow();

        // If a stale connection exists for this device, kill its drain loop
        // first — the new connection takes over.
        if (_connections.TryRemove(deviceId, out var existing))
            existing.DrainCts.Cancel();

        var cts = new CancellationTokenSource();
        _connections[deviceId] = new AgentConnection(Context.ConnectionId, cts);
        signaling.BindAgent(deviceId, Context.ConnectionId);

        await devices.MarkOnlineAsync(deviceId);
        await BroadcastDeviceList();

        log.LogInformation("Agent {DeviceId} connected ({ConnectionId})", deviceId, Context.ConnectionId);

        // Spawn the input drain loop. Each agent has its own bounded channel
        // (DropOldest at capacity). The loop pushes events one-by-one to the
        // owning connection until the agent disconnects.
        _ = DrainInputAsync(deviceId, Context.ConnectionId, cts.Token);

        // If a viewer was already waiting (browser hit Connect before the agent
        // came online — or the agent reconnected mid-session), kick a fresh
        // capture handshake so signaling can converge again. Carries the same
        // iceServers payload as the normal WatchDevice→StartCapture push.
        if (signaling.ViewerOf(deviceId) is not null)
        {
            var iceServers = turn.BuildIceServers($"device:{deviceId}");
            await Clients.Caller.SendAsync("StartCapture", iceServers);
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var deviceId = TryGetDeviceId();
        if (deviceId is not null)
        {
            // Only flip to offline if THIS connection was still the registered one.
            // A reconnect-then-disconnect-of-old race shouldn't take the device offline.
            if (_connections.TryGetValue(deviceId.Value, out var current)
                && current.ConnectionId == Context.ConnectionId)
            {
                _connections.TryRemove(deviceId.Value, out _);
                current.DrainCts.Cancel();
                signaling.UnbindAgent(deviceId.Value, Context.ConnectionId);
                await devices.MarkOfflineAsync(deviceId.Value);

                // If a browser session was active on this device, end it.
                var active = await sessions.ActiveForAsync(deviceId.Value);
                if (active is not null)
                {
                    await sessions.EndAsync(active.Id, DisconnectReason.DeviceOffline);
                    await controlHub.Clients.All.SendAsync("SessionEnded", deviceId.Value, "device_offline");
                    signaling.UnbindAnyViewer(deviceId.Value);
                }

                await BroadcastDeviceList();
                log.LogInformation("Agent {DeviceId} disconnected", deviceId);
            }
        }
        await base.OnDisconnectedAsync(exception);
    }

    // Agent calls this once after connecting to confirm its identity and push
    // initial telemetry. Optional but useful as a sanity check.
    public async Task RegisterDevice(AgentRegistration reg)
    {
        var deviceId = GetDeviceIdOrThrow();
        devices.UpdateStatus(deviceId, reg.Battery, reg.Signal);
        await devices.TouchLastSeenAsync(deviceId);
        await BroadcastDeviceList();
    }

    public async Task ReportStatus(AgentStatus status)
    {
        var deviceId = GetDeviceIdOrThrow();
        devices.UpdateStatus(deviceId, status.Battery, status.Signal);
        await devices.TouchLastSeenAsync(deviceId);
        await BroadcastDeviceList();
    }

    // ── WebRTC signaling: agent → browser ────────────────────────────────

    // Phone has built its PeerConnection and is sending the offer SDP to the
    // browser. We forward to whichever browser connection is currently bound
    // as the viewer for this device.
    public async Task SendSdpOffer(string sdp)
    {
        var deviceId = GetDeviceIdOrThrow();
        var viewer = signaling.ViewerOf(deviceId);
        if (viewer is null)
        {
            log.LogDebug("SDP offer from {DeviceId} dropped — no viewer bound", deviceId);
            return;
        }
        await controlHub.Clients.Client(viewer).SendAsync("ReceiveSdpOffer", deviceId, sdp);
    }

    public async Task SendIceCandidate(IceCandidate candidate)
    {
        var deviceId = GetDeviceIdOrThrow();
        var viewer = signaling.ViewerOf(deviceId);
        if (viewer is null) return;
        await controlHub.Clients.Client(viewer).SendAsync("ReceiveIceCandidate", deviceId, candidate);
    }

    private async Task DrainInputAsync(Guid deviceId, string connectionId, CancellationToken ct)
    {
        // Use the singleton IHubContext rather than the per-call `this.Clients`
        // accessor — the Hub instance is disposed when OnConnectedAsync returns,
        // so this background loop would otherwise be sending through a dead
        // reference and silently no-op.
        try
        {
            await foreach (var input in inputRelay.ReadAllAsync(deviceId, ct))
            {
                await agentHub.Clients.Client(connectionId).SendAsync("ReceiveInput", input, ct);
            }
        }
        catch (OperationCanceledException) { /* expected on disconnect */ }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Input drain loop ended for {DeviceId}", deviceId);
        }
    }

    private Guid GetDeviceIdOrThrow()
    {
        var id = TryGetDeviceId();
        if (id is null) throw new HubException("invalid_device_token");
        return id.Value;
    }

    private Guid? TryGetDeviceId()
    {
        var raw = Context.User?.FindFirst("device_id")?.Value
                  ?? Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return Guid.TryParse(raw, out var g) ? g : null;
    }

    private async Task BroadcastDeviceList()
    {
        var all = await devices.AllAsync();
        var actives = await sessions.ActiveByDeviceAsync();
        var dto = all.Select(d => devices.ToDto(
            d, actives.TryGetValue(d.Id, out var s) ? SessionService.ConnectedFromSession(s) : null
        )).ToArray();
        await controlHub.Clients.All.SendAsync("DeviceListUpdated", dto);
    }

    private sealed record AgentConnection(string ConnectionId, CancellationTokenSource DrainCts);
}

public record AgentRegistration(int? Battery, int? Signal, string? Resolution);
public record AgentStatus(int? Battery, int? Signal);

// Wire format for an ICE candidate exchanged between agent and browser. Mirrors
// the fields of RTCIceCandidateInit on the browser side.
public class IceCandidate
{
    public string? Candidate { get; set; }
    public string? SdpMid { get; set; }
    public int? SdpMLineIndex { get; set; }
}
