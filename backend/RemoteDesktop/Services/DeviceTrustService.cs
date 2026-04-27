using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using RemoteDesktop.Data;
using RemoteDesktop.Models;

namespace RemoteDesktop.Services;

public class DeviceTrustService(IDbContextFactory<AppDbContext> dbf)
{
    public record TrustIssue(string Key, DateTimeOffset PairedAt);

    // Issue a fresh trust key for a device. Returns the secret key once — the
    // hash is persisted, the secret is given to the agent (or shown to the
    // admin in Phase 2 where there is no agent yet) and never stored again.
    public async Task<TrustIssue> IssueAsync(Guid deviceId)
    {
        var key = GenerateKey();
        var hash = BCrypt.Net.BCrypt.HashPassword(key);

        await using var db = await dbf.CreateDbContextAsync();
        var existing = await db.DeviceTrusts.FirstOrDefaultAsync(t => t.DeviceId == deviceId);
        if (existing is null)
        {
            db.DeviceTrusts.Add(new DeviceTrust
            {
                Id = Guid.NewGuid(),
                DeviceId = deviceId,
                KeyHash = hash,
                PairedAt = DateTimeOffset.UtcNow,
            });
        }
        else
        {
            existing.KeyHash = hash;
            existing.LastRotatedAt = DateTimeOffset.UtcNow;
            existing.RevokedAt = null;
        }
        await db.SaveChangesAsync();
        return new TrustIssue(key, DateTimeOffset.UtcNow);
    }

    public async Task<TrustIssue> RotateAsync(Guid deviceId) => await IssueAsync(deviceId);

    public async Task<bool> RevokeAsync(Guid deviceId)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var t = await db.DeviceTrusts.FirstOrDefaultAsync(x => x.DeviceId == deviceId);
        if (t is null || t.RevokedAt is not null) return false;
        t.RevokedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> VerifyAsync(Guid deviceId, string presentedKey)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var t = await db.DeviceTrusts.AsNoTracking().FirstOrDefaultAsync(x => x.DeviceId == deviceId);
        if (t is null || t.RevokedAt is not null) return false;
        return BCrypt.Net.BCrypt.Verify(presentedKey, t.KeyHash);
    }

    private static string GenerateKey()
    {
        Span<byte> buf = stackalloc byte[32];
        RandomNumberGenerator.Fill(buf);
        return Convert.ToHexString(buf).ToLowerInvariant();
    }
}
