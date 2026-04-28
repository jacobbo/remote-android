using Microsoft.EntityFrameworkCore;
using RemoteDesktop.Models;
using RemoteDesktop.Services;

namespace RemoteDesktop.Data;

public static class Seed
{
    public static async Task RunAsync(IServiceProvider sp)
    {
        var dbf = sp.GetRequiredService<IDbContextFactory<AppDbContext>>();
        var devices = sp.GetRequiredService<DeviceManagerService>();

        await using var db = await dbf.CreateDbContextAsync();

        if (!await db.Users.AnyAsync())
        {
            db.Users.AddRange(
                MakeUser("admin", "admin", "Alex Morgan", "alex@co.dev", UserRole.Admin),
                MakeUser("user1", "user1", "Jordan Lee", "jordan@co.dev", UserRole.User),
                MakeUser("user2", "user2", "Sam Chen", "sam@co.dev", UserRole.User)
            );
            await db.SaveChangesAsync();
        }

        if (!await db.Devices.AnyAsync())
        {
            var seeded = new[]
            {
                Make("Pixel 8 Pro", "Google Pixel 8 Pro", DeviceStatus.Online, "Android 14", "192.168.1.41", "1080x2400",
                    new DeviceRuntime { Battery = 87, Signal = 4, Orientation = "portrait" }),
                Make("Galaxy S24", "Samsung Galaxy S24", DeviceStatus.Online, "Android 14", "192.168.1.42", "1080x2340",
                    new DeviceRuntime { Battery = 54, Signal = 3, Orientation = "portrait" }),
                Make("OnePlus 12", "OnePlus 12",         DeviceStatus.Online, "Android 14", "192.168.1.43", "1440x3168",
                    new DeviceRuntime { Battery = 23, Signal = 5, Orientation = "portrait" }),
                Make("Pixel Fold", "Google Pixel Fold",  DeviceStatus.Idle,   "Android 14", "192.168.1.44", "1840x2208",
                    new DeviceRuntime { Battery = 95, Signal = 4, Orientation = "landscape" }, lastSeenMinutesAgo: 2),
                Make("Galaxy A54", "Samsung Galaxy A54", DeviceStatus.Offline,"Android 13", "192.168.1.45", "1080x2340",
                    new DeviceRuntime { Battery = 12, Signal = 0, Orientation = "portrait" }, lastSeenMinutesAgo: 60),
                Make("Xiaomi 14", "Xiaomi 14",           DeviceStatus.Online, "Android 14", "192.168.1.46", "1200x2670",
                    new DeviceRuntime { Battery = 71, Signal = 3, Orientation = "portrait" }),
                Make("Nothing Phone 2", "Nothing Phone (2)", DeviceStatus.Online, "Android 14", "192.168.1.47", "1080x2412",
                    new DeviceRuntime { Battery = 44, Signal = 2, Orientation = "portrait" }),
            };
            db.Devices.AddRange(seeded.Select(s => s.device));
            await db.SaveChangesAsync();
            foreach (var (device, runtime) in seeded) devices.SeedRuntime(device.Id, runtime);
        }
        else
        {
            // Server restart: rehydrate runtime cache for existing devices.
            await foreach (var d in db.Devices.AsNoTracking().AsAsyncEnumerable())
                devices.SeedRuntime(d.Id, new DeviceRuntime { Orientation = "portrait" });
        }

        if (!await db.Sessions.AnyAsync())
        {
            var users = await db.Users.ToListAsync();
            var devs = await db.Devices.ToListAsync();
            if (users.Count > 0 && devs.Count > 0)
            {
                var rng = new Random(42);
                var reasons = new[] { DisconnectReason.User, DisconnectReason.User, DisconnectReason.User, DisconnectReason.Network, DisconnectReason.Admin, DisconnectReason.Timeout, DisconnectReason.DeviceOffline };
                for (var i = 0; i < 20; i++)
                {
                    var u = users[rng.Next(users.Count)];
                    var d = devs[rng.Next(devs.Count)];
                    var started = DateTimeOffset.UtcNow.AddDays(-rng.Next(0, 5)).AddHours(-rng.Next(0, 24)).AddMinutes(-rng.Next(0, 60));
                    var dur = TimeSpan.FromSeconds(rng.Next(30, 1500));
                    db.Sessions.Add(new Session
                    {
                        Id = Guid.NewGuid(),
                        UserId = u.Id,
                        DeviceId = d.Id,
                        Status = SessionStatus.Disconnected,
                        StartedAt = started,
                        EndedAt = started + dur,
                        Reason = reasons[rng.Next(reasons.Length)],
                        UserDisplayName = u.DisplayName,
                    });
                }
                await db.SaveChangesAsync();
            }
        }
    }

    private static User MakeUser(string username, string password, string displayName, string email, UserRole role) =>
        new()
        {
            Id = Guid.NewGuid(),
            Username = username,
            DisplayName = displayName,
            Email = email,
            Role = role,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
        };

    private static (Device device, DeviceRuntime runtime) Make(
        string name, string model, DeviceStatus status, string os, string ip, string resolution,
        DeviceRuntime runtime, int? lastSeenMinutesAgo = null)
    {
        var d = new Device
        {
            Id = Guid.NewGuid(),
            Name = name,
            Model = model,
            OsVersion = os,
            IpAddress = ip,
            Resolution = resolution,
            Status = status,
            LastSeenAt = lastSeenMinutesAgo is null
                ? DateTimeOffset.UtcNow
                : DateTimeOffset.UtcNow.AddMinutes(-lastSeenMinutesAgo.Value),
        };
        return (d, runtime);
    }
}
