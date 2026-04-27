using System.Security.Cryptography;
using System.Text;

namespace RemoteDesktop.Services;

// Mints ephemeral TURN credentials using coturn's "REST API" / time-limited
// shared-secret scheme:
//
//   username   = "<unix-expiry>:<subject>"
//   credential = base64( HMAC-SHA1( static-secret, username ) )
//
// coturn validates this server-side from the same shared secret (set via
// `--static-auth-secret=` and `--use-auth-secret`). When `Turn:Secret` or
// `Turn:Hostname` is unset — typical for LAN-only dev — returns an empty
// list so callers can build a peer connection with no relay. Browsers and
// the Android agent treat an empty iceServers list as "host candidates only",
// which is exactly the desired behaviour on the LAN.
public sealed class TurnService(IConfiguration cfg)
{
    public int TtlSeconds => cfg.GetValue<int?>("Turn:TtlSeconds") ?? 86400;

    public IceServer[] BuildIceServers(string subject)
    {
        var secret = cfg["Turn:Secret"];
        var hostname = cfg["Turn:Hostname"];
        if (string.IsNullOrWhiteSpace(secret) || string.IsNullOrWhiteSpace(hostname))
            return Array.Empty<IceServer>();

        var port = cfg.GetValue<int?>("Turn:Port") ?? 3478;
        var expiry = DateTimeOffset.UtcNow.AddSeconds(TtlSeconds).ToUnixTimeSeconds();
        var username = $"{expiry}:{subject}";

        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(secret));
        var credential = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(username)));

        var urls = new[]
        {
            $"turn:{hostname}:{port}?transport=udp",
            $"turn:{hostname}:{port}?transport=tcp",
        };
        return new[] { new IceServer(urls, username, credential) };
    }
}

// Wire shape matches the WebRTC RTCIceServer dictionary
// (https://www.w3.org/TR/webrtc/#dom-rtciceserver) so the frontend can drop
// the array straight into `new RTCPeerConnection({ iceServers })`.
public record IceServer(string[] Urls, string Username, string Credential);
