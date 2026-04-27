using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using RemoteDesktop.Models;
using RemoteDesktop.Services;

namespace RemoteDesktop.Hubs;

[Authorize(Roles = "admin,user")]
public class ControlHub(
    DeviceManagerService devices,
    SessionService sessions,
    UserService users,
    InputRelayService inputRelay,
    WebRtcSignalingService signaling,
    TurnService turn,
    IHubContext<AgentHub> agentHub,
    ILogger<ControlHub> log
) : Hub
{
    public override async Task OnConnectedAsync()
    {
        log.LogInformation("SignalR connection {ConnectionId} for {User}", Context.ConnectionId, Context.User?.Identity?.Name);
        await Clients.Caller.SendAsync("DeviceListUpdated", await BuildDeviceListAsync());
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        // Browser closed mid-session — end any session this connection was viewing
        // and tell the agent to stop capturing. We don't track which deviceId this
        // connection was bound to; instead we rely on UnbindViewer matching by id.
        var caller = await TryGetCallerAsync();
        if (caller is not null)
        {
            var owned = await sessions.ActiveForUserAsync(caller.Id);
            foreach (var s in owned)
            {
                await sessions.EndAsync(s.Id, DisconnectReason.Network);
                signaling.UnbindViewer(s.DeviceId, Context.ConnectionId);
                await NotifyAgentStopCapture(s.DeviceId);
            }
            if (owned.Count > 0) await BroadcastDeviceListAsync();
        }
        await base.OnDisconnectedAsync(exception);
    }

    public async Task<object> WatchDevice(Guid deviceId)
    {
        var caller = await GetCallerOrThrowAsync();
        var device = await devices.GetAsync(deviceId) ?? throw new HubException("device_not_found");

        var active = await sessions.ActiveForAsync(deviceId);
        if (active is not null && active.UserId != caller.Id)
            return new { error = "device_in_use", connectedUser = active.UserDisplayName };

        Guid sessionId;
        if (active is not null && active.UserId == caller.Id)
        {
            sessionId = active.Id;
        }
        else
        {
            var session = await sessions.CreateAsync(caller.Id, caller.DisplayName, deviceId);
            sessionId = session.Id;
        }

        // Bind this browser connection as the viewer and trigger the agent to
        // start capture + create a WebRTC offer. If the agent is offline the
        // signal is silently dropped — the agent's OnConnectedAsync will see a
        // viewer is bound and send "StartCapture" itself when it reconnects.
        signaling.BindViewer(deviceId, Context.ConnectionId);
        await NotifyAgentStartCapture(deviceId);
        await BroadcastDeviceListAsync();

        // Mint the browser's TURN credentials right here so the WatchDevice
        // round-trip carries everything the RTCPeerConnection needs. Empty list
        // when Turn:* config is unset — peer falls back to host candidates.
        var iceServers = turn.BuildIceServers($"viewer:{caller.Id}");
        return new { ok = true, sessionId, iceServers };
    }

    public async Task StopWatching(Guid deviceId)
    {
        var caller = await GetCallerOrThrowAsync();
        var active = await sessions.ActiveForAsync(deviceId);
        if (active is null || active.UserId != caller.Id) return;

        await sessions.EndAsync(active.Id, DisconnectReason.User);
        signaling.UnbindViewer(deviceId, Context.ConnectionId);
        await NotifyAgentStopCapture(deviceId);
        await BroadcastDeviceListAsync();
    }

    public async Task SendInput(Guid deviceId, InputEvent input)
    {
        var caller = await GetCallerOrThrowAsync();
        var active = await sessions.ActiveForAsync(deviceId);
        if (active is null || active.UserId != caller.Id)
            throw new HubException("not_session_owner");

        await inputRelay.QueueAsync(deviceId, input);
    }

    [Authorize(Roles = "admin")]
    public async Task ForceDisconnect(Guid deviceId)
    {
        var active = await sessions.ActiveForAsync(deviceId);
        if (active is null) return;

        await sessions.EndAsync(active.Id, DisconnectReason.Admin);
        signaling.UnbindAnyViewer(deviceId);
        await NotifyAgentStopCapture(deviceId);
        await Clients.All.SendAsync("SessionEnded", deviceId, "admin");
        await BroadcastDeviceListAsync();
    }

    // ── WebRTC signaling: browser → agent ────────────────────────────────

    public async Task SendSdpAnswer(Guid deviceId, string sdp)
    {
        if (!await CallerOwnsSessionAsync(deviceId)) throw new HubException("not_session_owner");
        var agent = signaling.AgentOf(deviceId);
        if (agent is null) return;
        await agentHub.Clients.Client(agent).SendAsync("ReceiveSdpAnswer", sdp);
    }

    public async Task SendIceCandidate(Guid deviceId, IceCandidate candidate)
    {
        if (!await CallerOwnsSessionAsync(deviceId)) throw new HubException("not_session_owner");
        var agent = signaling.AgentOf(deviceId);
        if (agent is null) return;
        await agentHub.Clients.Client(agent).SendAsync("ReceiveIceCandidate", candidate);
    }

    private async Task<bool> CallerOwnsSessionAsync(Guid deviceId)
    {
        var caller = await GetCallerOrThrowAsync();
        var active = await sessions.ActiveForAsync(deviceId);
        return active is not null && active.UserId == caller.Id;
    }

    private Task NotifyAgentStartCapture(Guid deviceId)
    {
        var agent = signaling.AgentOf(deviceId);
        if (agent is null) return Task.CompletedTask;
        // Agent's iceServers are minted with the device-id as the subject so
        // coturn's logs attribute relay traffic to the device, not the viewer.
        var iceServers = turn.BuildIceServers($"device:{deviceId}");
        return agentHub.Clients.Client(agent).SendAsync("StartCapture", iceServers);
    }

    private Task NotifyAgentStopCapture(Guid deviceId)
    {
        var agent = signaling.AgentOf(deviceId);
        return agent is null ? Task.CompletedTask
            : agentHub.Clients.Client(agent).SendAsync("StopCapture");
    }

    private async Task<DeviceDto[]> BuildDeviceListAsync()
    {
        var all = await devices.AllAsync();
        var actives = await sessions.ActiveByDeviceAsync();
        return all.Select(d =>
            devices.ToDto(d, actives.TryGetValue(d.Id, out var s) ? SessionService.ConnectedFromSession(s) : null)
        ).ToArray();
    }

    private async Task BroadcastDeviceListAsync() =>
        await Clients.All.SendAsync("DeviceListUpdated", await BuildDeviceListAsync());

    private async Task<CallerInfo> GetCallerOrThrowAsync()
    {
        var info = await TryGetCallerAsync();
        return info ?? throw new HubException("unauthorized");
    }

    private async Task<CallerInfo?> TryGetCallerAsync()
    {
        var sub = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value
                  ?? Context.User?.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var id)) return null;
        var user = await users.FindByIdAsync(id);
        return user is null ? null : new CallerInfo(user.Id, user.Username, user.DisplayName);
    }

    private record CallerInfo(Guid Id, string Username, string DisplayName);
}
