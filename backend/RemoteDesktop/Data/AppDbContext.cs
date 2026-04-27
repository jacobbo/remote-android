using Microsoft.EntityFrameworkCore;
using RemoteDesktop.Models;

namespace RemoteDesktop.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<DeviceTrust> DeviceTrusts => Set<DeviceTrust>();
    public DbSet<Session> Sessions => Set<Session>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.ToTable("users");
            e.HasKey(x => x.Id);
            e.Property(x => x.Username).HasMaxLength(50).IsRequired();
            e.HasIndex(x => x.Username).IsUnique();
            e.Property(x => x.DisplayName).HasMaxLength(100).IsRequired();
            e.Property(x => x.Email).HasMaxLength(200);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(10).IsRequired();
            e.Property(x => x.PasswordHash).HasMaxLength(200).IsRequired();
        });

        b.Entity<Device>(e =>
        {
            e.ToTable("devices");
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(100).IsRequired();
            e.Property(x => x.Model).HasMaxLength(100);
            e.Property(x => x.OsVersion).HasMaxLength(50);
            e.Property(x => x.Resolution).HasMaxLength(20);
            e.Property(x => x.IpAddress).HasMaxLength(45);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10).IsRequired();
            e.HasOne(x => x.Trust)
                .WithOne(t => t.Device!)
                .HasForeignKey<DeviceTrust>(t => t.DeviceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DeviceTrust>(e =>
        {
            e.ToTable("device_trusts");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.DeviceId).IsUnique();
            e.Property(x => x.KeyHash).HasMaxLength(200).IsRequired();
        });

        b.Entity<Session>(e =>
        {
            e.ToTable("sessions");
            e.HasKey(x => x.Id);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(15).IsRequired();
            e.Property(x => x.Reason).HasConversion<string?>().HasMaxLength(50);
            e.Property(x => x.UserDisplayName).HasMaxLength(100).IsRequired();
            e.HasIndex(x => new { x.DeviceId, x.StartedAt });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Device).WithMany().HasForeignKey(x => x.DeviceId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
