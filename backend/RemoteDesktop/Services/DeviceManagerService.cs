using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using RemoteDesktop.Data;
using RemoteDesktop.Models;

namespace RemoteDesktop.Services;

public class DeviceManagerService(IDbContextFactory<AppDbContext> dbf)
{
    public const int MaxDevices = 10;

    // Volatile per-device runtime state (battery/signal/fps/...). Lives in
    // memory only — reported by the device agent in Phase 3+.
    private readonly ConcurrentDictionary<Guid, DeviceRuntime> _runtime = new();

    public async Task<int> CountAsync()
    {
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Devices.CountAsync();
    }

    public async Task<IReadOnlyList<Device>> AllAsync()
    {
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Devices.AsNoTracking().OrderBy(d => d.Name).ToListAsync();
    }

    public async Task<Device?> GetAsync(Guid id)
    {
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Devices.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id);
    }

    public async Task<Device> AddAsync(string name, string? model, string? os, string? ip)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("name is required");

        await using var db = await dbf.CreateDbContextAsync();
        if (await db.Devices.CountAsync() >= MaxDevices)
            throw new InvalidOperationException("max_devices_reached");

        var d = new Device
        {
            Id = Guid.NewGuid(),
            Name = name.Trim(),
            Model = string.IsNullOrWhiteSpace(model) ? null : model.Trim(),
            OsVersion = string.IsNullOrWhiteSpace(os) ? null : os.Trim(),
            IpAddress = string.IsNullOrWhiteSpace(ip) ? null : ip.Trim(),
            Resolution = "1080x2400",
            Status = DeviceStatus.Online,
            LastSeenAt = DateTimeOffset.UtcNow,
        };
        db.Devices.Add(d);
        await db.SaveChangesAsync();

        _runtime[d.Id] = new DeviceRuntime { Battery = 100, Signal = 4, Orientation = "portrait" };
        return d;
    }

    public async Task DeleteAsync(Guid id)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var d = await db.Devices.FindAsync(id);
        if (d is null) return;
        db.Devices.Remove(d);
        await db.SaveChangesAsync();
        _runtime.TryRemove(id, out _);
    }

    public DeviceRuntime Runtime(Guid id) =>
        _runtime.GetOrAdd(id, _ => new DeviceRuntime());

    public void SeedRuntime(Guid id, DeviceRuntime r) => _runtime[id] = r;

    // Agent telemetry — battery/signal/orientation. In-memory only.
    public void UpdateStatus(Guid id, int? battery, int? signal, string? orientation)
    {
        var r = _runtime.GetOrAdd(id, _ => new DeviceRuntime());
        if (battery is not null) r.Battery = battery;
        if (signal is not null) r.Signal = signal;
        if (!string.IsNullOrWhiteSpace(orientation)) r.Orientation = orientation;
    }

    // Agent media metrics — fps/bitrate/latency/dropped. In-memory only.
    public void UpdateMetrics(Guid id, int? fps, int? bitrateKbps, int? latencyMs, int? droppedFrames)
    {
        var r = _runtime.GetOrAdd(id, _ => new DeviceRuntime());
        if (fps is not null) r.Fps = fps;
        if (bitrateKbps is not null) r.BitrateKbps = bitrateKbps;
        if (latencyMs is not null) r.LatencyMs = latencyMs;
        if (droppedFrames is not null) r.DroppedFrames = droppedFrames;
    }

    // Persist online/offline transitions and last-seen timestamps.
    public async Task MarkOnlineAsync(Guid id)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var d = await db.Devices.FindAsync(id);
        if (d is null) return;
        d.Status = DeviceStatus.Online;
        d.LastSeenAt = DateTimeOffset.UtcNow;
        d.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
    }

    public async Task MarkOfflineAsync(Guid id)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var d = await db.Devices.FindAsync(id);
        if (d is null) return;
        d.Status = DeviceStatus.Offline;
        d.LastSeenAt = DateTimeOffset.UtcNow;
        d.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
    }

    public async Task TouchLastSeenAsync(Guid id)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var d = await db.Devices.FindAsync(id);
        if (d is null) return;
        d.LastSeenAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
    }

    public DeviceDto ToDto(Device d, ConnectedUserInfo? connected = null)
    {
        var r = _runtime.GetValueOrDefault(d.Id) ?? new DeviceRuntime();
        return new DeviceDto(
            d.Id,
            d.Name,
            d.Model,
            d.Status.ToString().ToLowerInvariant(),
            r.Battery,
            r.Signal,
            d.Resolution,
            r.Orientation,
            d.OsVersion,
            d.IpAddress,
            d.LastSeenAt?.ToUnixTimeMilliseconds(),
            r.Fps,
            r.BitrateKbps,
            r.LatencyMs,
            r.DroppedFrames,
            connected is null
                ? null
                : new ConnectedUserDto(connected.Id, connected.DisplayName, connected.Since.ToUnixTimeMilliseconds())
        );
    }
}
