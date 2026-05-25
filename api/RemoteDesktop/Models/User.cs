namespace RemoteDesktop.Models;

public enum UserRole { User, Admin }

public class User
{
    public Guid Id { get; set; }
    // Single identifier — used for login, JWT subject, and the display value
    // shown in the UI. Required + unique at the schema level.
    public string Email { get; set; } = "";
    public UserRole Role { get; set; }
    public string PasswordHash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public record UserDto(Guid Id, string Email, string Role);
