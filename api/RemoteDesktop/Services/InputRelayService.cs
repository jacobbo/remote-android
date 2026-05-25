using System.Collections.Concurrent;
using System.Threading.Channels;
using RemoteDesktop.Models;

namespace RemoteDesktop.Services;

// Per-device bounded channel of pending input events. The Android agent
// (Phase 3+) will subscribe and drain these. For now, browsers can call
// QueueAsync and events sit in the channel; an idle channel drops the
// oldest events when at capacity (backpressure policy from the plan).
public class InputRelayService(ILogger<InputRelayService> log)
{
    public const int PerDeviceBuffer = 64;

    private readonly ConcurrentDictionary<Guid, Channel<InputEvent>> _channels = new();

    public ValueTask QueueAsync(Guid deviceId, InputEvent input, CancellationToken ct = default)
    {
        var ch = _channels.GetOrAdd(deviceId, _ => Channel.CreateBounded<InputEvent>(
            new BoundedChannelOptions(PerDeviceBuffer)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false,
            }));

        log.LogDebug("Queue input for {DeviceId}: {Type}", deviceId, input.Type);
        return ch.Writer.WriteAsync(input, ct);
    }

    public IAsyncEnumerable<InputEvent> ReadAllAsync(Guid deviceId, CancellationToken ct = default)
    {
        var ch = _channels.GetOrAdd(deviceId, _ => Channel.CreateBounded<InputEvent>(
            new BoundedChannelOptions(PerDeviceBuffer) { FullMode = BoundedChannelFullMode.DropOldest }));
        return ch.Reader.ReadAllAsync(ct);
    }

    public void Drop(Guid deviceId)
    {
        if (_channels.TryRemove(deviceId, out var ch)) ch.Writer.TryComplete();
    }
}
