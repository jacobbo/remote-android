namespace RemoteDesktop.Models;

public enum SessionStatus { Connecting, Connected, Disconnected }

public enum DisconnectReason { User, Admin, Timeout, Network, DeviceOffline, Error }

public class Session
{
    public Guid Id { get; set; }
    // Nullable so that deleting a user preserves their session history
    // (the display name snapshot below remains readable).
    public Guid? UserId { get; set; }
    public Guid DeviceId { get; set; }
    public SessionStatus Status { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? EndedAt { get; set; }
    public DisconnectReason? Reason { get; set; }

    public string UserDisplayName { get; set; } = "";

    public User? User { get; set; }
    public Device? Device { get; set; }
}

public record SessionDto(
    Guid Id,
    string User,
    string Started,
    string? Ended,
    string Duration,
    string Reason
);
