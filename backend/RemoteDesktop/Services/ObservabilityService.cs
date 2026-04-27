using System.Collections.Concurrent;

namespace RemoteDesktop.Services;

// Aggregates per-device runtime metrics + counters that the dashboard surfaces
// via /api/metrics. Pure in-memory; this is observability, not source of truth.
//
// Sources:
//   • Per-tick metrics (fps/bitrate/latency/dropped) come in via AgentHub.ReportMetrics
//   • Reconnect counters bump on AgentHub.OnConnectedAsync
//   • Session counts derive from SessionService (queried on demand, not cached)
public class ObservabilityService
{
    public record Snapshot(
        int? Fps,
        int? BitrateKbps,
        int? LatencyMs,
        int? DroppedFrames,
        long Timestamp);

    public record DeviceMetrics(
        Guid DeviceId,
        Snapshot Current,
        int ReconnectCount,
        long? LastConnectedAt);

    public record Summary(
        int TotalDevices,
        int OnlineDevices,
        int ActiveSessions,
        int TotalReconnects,
        IReadOnlyList<DeviceMetrics> Devices);

    private readonly ConcurrentDictionary<Guid, Snapshot> _current = new();
    private readonly ConcurrentDictionary<Guid, int> _reconnects = new();
    private readonly ConcurrentDictionary<Guid, long> _lastConnectedAt = new();

    public Snapshot Track(Guid deviceId, int? fps, int? bitrateKbps, int? latencyMs, int? droppedFrames)
    {
        // Carry forward any field that this report didn't include so the
        // current view is always "best known" rather than "last partial".
        var prev = _current.GetValueOrDefault(deviceId);
        var snap = new Snapshot(
            Fps: fps ?? prev?.Fps,
            BitrateKbps: bitrateKbps ?? prev?.BitrateKbps,
            LatencyMs: latencyMs ?? prev?.LatencyMs,
            DroppedFrames: droppedFrames ?? prev?.DroppedFrames,
            Timestamp: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        _current[deviceId] = snap;
        return snap;
    }

    public Snapshot? Get(Guid deviceId) => _current.GetValueOrDefault(deviceId);

    public void RecordReconnect(Guid deviceId)
    {
        _reconnects.AddOrUpdate(deviceId, 1, (_, v) => v + 1);
        _lastConnectedAt[deviceId] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    public void Forget(Guid deviceId)
    {
        _current.TryRemove(deviceId, out _);
        _reconnects.TryRemove(deviceId, out _);
        _lastConnectedAt.TryRemove(deviceId, out _);
    }

    public DeviceMetrics ForDevice(Guid deviceId) => new(
        DeviceId: deviceId,
        Current: _current.GetValueOrDefault(deviceId) ?? EmptySnapshot,
        ReconnectCount: _reconnects.GetValueOrDefault(deviceId),
        LastConnectedAt: _lastConnectedAt.TryGetValue(deviceId, out var t) ? t : null);

    public Summary BuildSummary(IEnumerable<Guid> allDeviceIds, int onlineCount, int activeSessionCount)
    {
        var perDevice = allDeviceIds.Select(ForDevice).ToArray();
        var totalReconnects = _reconnects.Values.Sum();
        return new Summary(
            TotalDevices: perDevice.Length,
            OnlineDevices: onlineCount,
            ActiveSessions: activeSessionCount,
            TotalReconnects: totalReconnects,
            Devices: perDevice);
    }

    private static readonly Snapshot EmptySnapshot = new(null, null, null, null, 0);
}
