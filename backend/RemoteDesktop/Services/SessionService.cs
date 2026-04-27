using Microsoft.EntityFrameworkCore;
using RemoteDesktop.Data;
using RemoteDesktop.Models;

namespace RemoteDesktop.Services;

public class SessionService(IDbContextFactory<AppDbContext> dbf)
{
    public async Task<Session> CreateAsync(Guid userId, string userDisplay, Guid deviceId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var s = new Session
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            UserDisplayName = userDisplay,
            DeviceId = deviceId,
            Status = SessionStatus.Connecting,
            StartedAt = DateTimeOffset.UtcNow,
        };
        db.Sessions.Add(s);
        await db.SaveChangesAsync();
        return s;
    }

    public async Task<Session?> ActiveForAsync(Guid deviceId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Sessions.AsNoTracking()
            .Where(s => s.DeviceId == deviceId && s.Status != SessionStatus.Disconnected)
            .OrderByDescending(s => s.StartedAt)
            .FirstOrDefaultAsync();
    }

    public async Task<Dictionary<Guid, Session>> ActiveByDeviceAsync()
    {
        await using var db = await dbf.CreateDbContextAsync();
        var actives = await db.Sessions.AsNoTracking()
            .Where(s => s.Status != SessionStatus.Disconnected)
            .ToListAsync();
        // If multiple "active" rows exist for the same device (shouldn't happen,
        // but defend against it), keep the most recent.
        return actives
            .GroupBy(s => s.DeviceId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(s => s.StartedAt).First());
    }

    public async Task<IReadOnlyList<Session>> ActiveForUserAsync(Guid userId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Sessions.AsNoTracking()
            .Where(s => s.UserId == userId && s.Status != SessionStatus.Disconnected)
            .ToListAsync();
    }

    public async Task EndAsync(Guid sessionId, DisconnectReason reason)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var s = await db.Sessions.FindAsync(sessionId);
        if (s is null) return;
        s.Status = SessionStatus.Disconnected;
        s.EndedAt = DateTimeOffset.UtcNow;
        s.Reason = reason;
        await db.SaveChangesAsync();
    }

    public async Task MarkConnectedAsync(Guid sessionId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var s = await db.Sessions.FindAsync(sessionId);
        if (s is null) return;
        s.Status = SessionStatus.Connected;
        await db.SaveChangesAsync();
    }

    public async Task<IReadOnlyList<Session>> RecentForDeviceAsync(Guid deviceId, int limit = 10)
    {
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Sessions.AsNoTracking()
            .Where(s => s.DeviceId == deviceId)
            .OrderByDescending(s => s.StartedAt)
            .Take(limit)
            .ToListAsync();
    }

    public static ConnectedUserInfo? ConnectedFromSession(Session? s) =>
        s is null ? null : new ConnectedUserInfo(s.UserId ?? Guid.Empty, s.UserDisplayName, s.StartedAt);

    public static SessionDto ToDto(Session s)
    {
        var ended = s.EndedAt ?? DateTimeOffset.UtcNow;
        var dur = ended - s.StartedAt;
        var mins = (int)dur.TotalMinutes;
        var secs = dur.Seconds;
        return new SessionDto(
            s.Id,
            string.IsNullOrEmpty(s.UserDisplayName) ? "Unknown" : s.UserDisplayName,
            s.StartedAt.ToString("yyyy-MM-dd HH:mm"),
            s.EndedAt?.ToString("yyyy-MM-dd HH:mm"),
            $"{mins}m {secs:D2}s",
            (s.Reason ?? DisconnectReason.User).ToString().ToLowerInvariant()
        );
    }
}
