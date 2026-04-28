namespace RemoteDesktop.Models;

public class DeviceTrust
{
    public Guid Id { get; set; }
    public Guid DeviceId { get; set; }
    public string KeyHash { get; set; } = "";
    public DateTimeOffset PairedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? RevokedAt { get; set; }

    public Device? Device { get; set; }
}
