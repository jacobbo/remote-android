using Microsoft.EntityFrameworkCore;
using RemoteDesktop.Data;
using RemoteDesktop.Models;

namespace RemoteDesktop.Services;

public class UserService(IDbContextFactory<AppDbContext> dbf)
{
    public async Task<User?> FindByUsernameAsync(string username)
    {
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Users.FirstOrDefaultAsync(u => u.Username == username);
    }

    public async Task<User?> FindByIdAsync(Guid id)
    {
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Users.FindAsync(id);
    }

    public bool Verify(User user, string password) =>
        BCrypt.Net.BCrypt.Verify(password, user.PasswordHash);

    public async Task<IReadOnlyList<User>> AllAsync()
    {
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Users.AsNoTracking().OrderBy(u => u.DisplayName).ToListAsync();
    }

    public async Task<User> CreateAsync(string username, string password, string displayName, string? email, UserRole role)
    {
        if (string.IsNullOrWhiteSpace(username)) throw new ArgumentException("username is required");
        if (string.IsNullOrWhiteSpace(password) || password.Length < 4) throw new ArgumentException("password must be at least 4 characters");
        if (string.IsNullOrWhiteSpace(displayName)) throw new ArgumentException("displayName is required");

        await using var db = await dbf.CreateDbContextAsync();
        var trimmed = username.Trim();
        if (await db.Users.AnyAsync(u => u.Username == trimmed)) throw new InvalidOperationException("username_taken");

        var u = new User
        {
            Id = Guid.NewGuid(),
            Username = trimmed,
            DisplayName = displayName.Trim(),
            Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim(),
            Role = role,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
        };
        db.Users.Add(u);
        await db.SaveChangesAsync();
        return u;
    }

    public async Task<User?> UpdateAsync(Guid id, string displayName, string? email, UserRole role)
    {
        if (string.IsNullOrWhiteSpace(displayName)) throw new ArgumentException("displayName is required");

        await using var db = await dbf.CreateDbContextAsync();
        var u = await db.Users.FindAsync(id);
        if (u is null) return null;
        u.DisplayName = displayName.Trim();
        u.Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
        u.Role = role;
        u.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return u;
    }

    public async Task<bool> ChangePasswordAsync(Guid id, string newPassword)
    {
        if (string.IsNullOrWhiteSpace(newPassword) || newPassword.Length < 4)
            throw new ArgumentException("password must be at least 4 characters");

        await using var db = await dbf.CreateDbContextAsync();
        var u = await db.Users.FindAsync(id);
        if (u is null) return false;
        u.PasswordHash = BCrypt.Net.BCrypt.HashPassword(newPassword);
        u.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return true;
    }

    public async Task<int> CountAdminsAsync()
    {
        await using var db = await dbf.CreateDbContextAsync();
        return await db.Users.CountAsync(u => u.Role == UserRole.Admin);
    }

    public async Task<bool> DeleteAsync(Guid id)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var u = await db.Users.FindAsync(id);
        if (u is null) return false;
        // Detach historical sessions so the audit trail is preserved.
        var sessions = db.Sessions.Where(s => s.UserId == id);
        await foreach (var s in sessions.AsAsyncEnumerable()) s.UserId = null;
        db.Users.Remove(u);
        await db.SaveChangesAsync();
        return true;
    }

    public static UserDto ToDto(User u) =>
        new(u.Id, u.Username, u.DisplayName, u.Email, u.Role.ToString().ToLowerInvariant());
}
