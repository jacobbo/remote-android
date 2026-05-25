using System.Collections.Concurrent;

namespace RemoteDesktop.Services;

// Lightweight registry that lets the two SignalR hubs find each other:
//
//   Browser invokes ControlHub.SendSdpAnswer(deviceId, sdp)
//     → ControlHub looks up the agent's connection id for that device
//     → forwards via IHubContext<AgentHub> to that one connection.
//
//   Agent invokes AgentHub.SendSdpOffer(sdp)
//     → AgentHub finds the viewer connection currently bound to this device
//     → forwards via IHubContext<ControlHub> to that one connection.
//
// Bindings are set by:
//   ControlHub.WatchDevice / OnDisconnectedAsync   → viewer
//   AgentHub.OnConnectedAsync / OnDisconnectedAsync → agent
//
// The service is intentionally state-free beyond the two maps — no signaling
// state is buffered. SDP/ICE only flow when both sides are connected.
public class WebRtcSignalingService
{
    private readonly ConcurrentDictionary<Guid, string> _viewers = new();
    private readonly ConcurrentDictionary<Guid, string> _agents = new();

    // ── Viewer (browser) bookkeeping ────────────────────────────────────

    public void BindViewer(Guid deviceId, string connectionId) =>
        _viewers[deviceId] = connectionId;

    // Removes the viewer binding only if the supplied connection is still
    // the registered one. Lets a fresh WatchDevice from another browser
    // safely supersede an old, lingering connection.
    public void UnbindViewer(Guid deviceId, string connectionId)
    {
        if (_viewers.TryGetValue(deviceId, out var current) && current == connectionId)
            _viewers.TryRemove(deviceId, out _);
    }

    // Releases whichever viewer connection is currently bound (used for
    // admin force-disconnect and device-offline teardown).
    public string? UnbindAnyViewer(Guid deviceId) =>
        _viewers.TryRemove(deviceId, out var c) ? c : null;

    public string? ViewerOf(Guid deviceId) =>
        _viewers.TryGetValue(deviceId, out var c) ? c : null;

    // ── Agent (phone) bookkeeping ──────────────────────────────────────

    public void BindAgent(Guid deviceId, string connectionId) =>
        _agents[deviceId] = connectionId;

    public void UnbindAgent(Guid deviceId, string connectionId)
    {
        if (_agents.TryGetValue(deviceId, out var current) && current == connectionId)
            _agents.TryRemove(deviceId, out _);
    }

    public string? AgentOf(Guid deviceId) =>
        _agents.TryGetValue(deviceId, out var c) ? c : null;
}
