namespace RemoteDesktop.Models;

public enum DeviceStatus { Online, Idle, Offline }

public class Device
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string? Model { get; set; }
    public string? OsVersion { get; set; }
    public string? Resolution { get; set; }
    public string? IpAddress { get; set; }
    public DeviceStatus Status { get; set; }
    public DateTimeOffset? LastSeenAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DeviceTrust? Trust { get; set; }
}

// Volatile per-device state held in memory only. Reported by the device agent
// (Phase 3+); seeded with sample values in Phase 2.
public class DeviceRuntime
{
    public string Orientation { get; set; } = "portrait";
    public int? Battery { get; set; }
    public int? Signal { get; set; }
}

public record ConnectedUserInfo(Guid Id, string DisplayName, DateTimeOffset Since);

public record DeviceDto(
    Guid Id,
    string Name,
    string? Model,
    string Status,
    int? Battery,
    int? Signal,
    string? Resolution,
    string? Orientation,
    string? Os,
    string? Ip,
    long? LastSeen,
    ConnectedUserDto? ConnectedUser
);

public record ConnectedUserDto(Guid Id, string DisplayName, long Since);
