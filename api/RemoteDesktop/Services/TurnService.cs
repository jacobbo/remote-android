using System.Security.Cryptography;
using System.Text;

namespace RemoteDesktop.Services;

// Builds the iceServers payload handed to both peers.
//
// Default: a single STUN entry (Cloudflare's public anycast resolver). STUN
// is needed for any non-LAN session so each peer can discover its public
// reflexive candidate; it's free, requires no auth, and Cloudflare's
// anycast network makes the single hostname effectively redundant.
//
// Optional TURN: when Turn:Secret AND Turn:Hostname are set, we additionally
// mint ephemeral TURN credentials using coturn's time-limited shared-secret
// scheme (HMAC-SHA1 over `<expiry>:<subject>`). The current deployment does
// NOT run coturn — direct P2P via STUN handles essentially all real-world
// sessions. The TURN code path is kept for the case where you later want to
// self-host coturn or point at a hosted TURN service (Twilio, Metered.ca).
public sealed class TurnService(IConfiguration cfg)
{
    private static readonly string[] DefaultStunUrls = { "stun:stun.cloudflare.com:3478" };

    public int TtlSeconds => cfg.GetValue<int?>("Turn:TtlSeconds") ?? 86400;

    public IceServer[] BuildIceServers(string subject)
    {
        var stun = new IceServer(DefaultStunUrls, null, null);

        var secret = cfg["Turn:Secret"];
        var hostname = cfg["Turn:Hostname"];
        if (string.IsNullOrWhiteSpace(secret) || string.IsNullOrWhiteSpace(hostname))
            return new[] { stun };

        var port = cfg.GetValue<int?>("Turn:Port") ?? 3478;
        var expiry = DateTimeOffset.UtcNow.AddSeconds(TtlSeconds).ToUnixTimeSeconds();
        var username = $"{expiry}:{subject}";

        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(secret));
        var credential = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(username)));

        var turnUrls = new[]
        {
            $"turn:{hostname}:{port}?transport=udp",
            $"turn:{hostname}:{port}?transport=tcp",
        };
        return new[] { stun, new IceServer(turnUrls, username, credential) };
    }
}

// Wire shape matches the WebRTC RTCIceServer dictionary
// (https://www.w3.org/TR/webrtc/#dom-rtciceserver) so the frontend can drop
// the array straight into `new RTCPeerConnection({ iceServers })`. Username
// and Credential are nullable because STUN entries don't carry auth.
public record IceServer(string[] Urls, string? Username, string? Credential);
