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

        // Server restart: rehydrate runtime cache for any persisted devices so
        // their dashboard rows have a non-null DeviceRuntime to read from
        // before the agent's first ReportStatus push lands.
        await foreach (var d in db.Devices.AsNoTracking().AsAsyncEnumerable())
            devices.SeedRuntime(d.Id, new DeviceRuntime());
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
}
