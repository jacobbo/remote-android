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
        var cfg = sp.GetRequiredService<IConfiguration>();
        var log = sp.GetRequiredService<ILogger<Program>>();

        await using var db = await dbf.CreateDbContextAsync();

        if (!await db.Users.AnyAsync())
        {
            // Production deployments MUST set Admin__Email and Admin__Password
            // via env vars. Falling back to admin@local / admin is fine for
            // `dotnet run` on a dev box but unsafe on any public-facing
            // deployment — the warning below is intentionally loud so a
            // misconfigured prod boot shows up in logs.
            var email = cfg["Admin:Email"];
            var password = cfg["Admin:Password"];
            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            {
                log.LogWarning("Admin:Email / Admin:Password not set — seeding default admin@local / admin. " +
                               "Set ADMIN_EMAIL and ADMIN_PASSWORD env vars in production.");
                email = "admin@local";
                password = "admin";
            }
            db.Users.Add(MakeUser(email, password, UserRole.Admin));
            await db.SaveChangesAsync();
            log.LogInformation("Seeded initial admin user {Email}", email);
        }

        // Server restart: rehydrate runtime cache for any persisted devices so
        // their dashboard rows have a non-null DeviceRuntime to read from
        // before the agent's first ReportStatus push lands.
        await foreach (var d in db.Devices.AsNoTracking().AsAsyncEnumerable())
            devices.SeedRuntime(d.Id, new DeviceRuntime());
    }

    private static User MakeUser(string email, string password, UserRole role) =>
        new()
        {
            Id = Guid.NewGuid(),
            Email = email,
            Role = role,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
        };
}
