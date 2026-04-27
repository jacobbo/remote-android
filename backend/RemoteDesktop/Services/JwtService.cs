using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using RemoteDesktop.Models;

namespace RemoteDesktop.Services;

public class JwtService
{
    private readonly SymmetricSecurityKey _key;
    private readonly string _issuer;
    private readonly string _audience;
    private readonly int _expiryMinutes;

    public JwtService(IConfiguration cfg)
    {
        var secret = Environment.GetEnvironmentVariable("JWT_SECRET")
                     ?? cfg["Jwt:Secret"]
                     ?? throw new InvalidOperationException("JWT secret is not configured. Set JWT_SECRET env var.");
        if (secret.Length < 32)
            throw new InvalidOperationException("JWT_SECRET must be at least 32 characters.");

        _key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        _issuer = cfg["Jwt:Issuer"] ?? "remote-desktop";
        _audience = cfg["Jwt:Audience"] ?? "remote-desktop-clients";
        _expiryMinutes = int.TryParse(cfg["Jwt:ExpiryMinutes"], out var m) ? m : 480;
    }

    public TokenValidationParameters ValidationParameters => new()
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateIssuerSigningKey = true,
        ValidateLifetime = true,
        ValidIssuer = _issuer,
        ValidAudience = _audience,
        IssuerSigningKey = _key,
        ClockSkew = TimeSpan.FromSeconds(30),
    };

    public string Issue(User user)
    {
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new Claim("username", user.Username),
            new Claim("displayName", user.DisplayName),
            new Claim(ClaimTypes.Role, user.Role.ToString().ToLowerInvariant()),
        };
        return Build(claims, _expiryMinutes);
    }

    public string IssueForDevice(Guid deviceId, string deviceName)
    {
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, deviceId.ToString()),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new Claim("device_id", deviceId.ToString()),
            new Claim("device_name", deviceName),
            new Claim(ClaimTypes.Role, "device"),
        };
        // Short-lived: agents reconnect + swap trustKey → fresh token regularly.
        return Build(claims, 60);
    }

    private string Build(IEnumerable<Claim> claims, int expiryMinutes)
    {
        var creds = new SigningCredentials(_key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(expiryMinutes),
            signingCredentials: creds
        );
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
