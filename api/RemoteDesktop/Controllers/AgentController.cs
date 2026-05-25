using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using RemoteDesktop.Hubs;
using RemoteDesktop.Models;
using RemoteDesktop.Services;

namespace RemoteDesktop.Controllers;

// Public agent endpoints. Authentication is by trust key (for connect) or by
// the one-time pairing token embedded in the QR (for pair). No JWT is required
// to call these — the swap is the JWT issuance step itself.
[ApiController]
[Route("api/agent")]
public class AgentController(
    DeviceManagerService devices,
    DeviceTrustService trust,
    PairingService pairing,
    JwtService jwt,
    SessionService sessions,
    IHubContext<ControlHub> hub
) : ControllerBase
{
    public record PairRequest(string Token, string Name, string? Model, string? OsVersion, string? IpAddress);
    public record PairResponse(Guid DeviceId, string Name, string TrustKey, string Token, int ExpiresInSeconds);

    public record ConnectRequest(Guid DeviceId, string TrustKey);
    public record ConnectResponse(string Token, int ExpiresInSeconds, string DeviceName);

    [HttpPost("pair")]
    public async Task<IActionResult> Pair([FromBody] PairRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Token)) return BadRequest(new { error = "token_required" });
        if (string.IsNullOrWhiteSpace(req.Name)) return BadRequest(new { error = "name_required" });
        if (!pairing.Consume(req.Token)) return BadRequest(new { error = "invalid_or_expired_token" });

        try
        {
            var d = await devices.AddAsync(req.Name, req.Model, req.OsVersion, req.IpAddress);
            var issued = await trust.IssueAsync(d.Id);
            var token = jwt.IssueForDevice(d.Id, d.Name);
            await BroadcastDeviceList();

            // Notify the admin's QR page so it can auto-advance. Token round-trips
            // so the page can match the broadcast against the QR it's displaying.
            await hub.Clients.All.SendAsync("PairingCompleted", req.Token, devices.ToDto(d));

            return Ok(new PairResponse(d.Id, d.Name, issued.Key, token, 60 * 60));
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { error = ex.Message }); }
    }

    [HttpPost("connect")]
    public async Task<IActionResult> Connect([FromBody] ConnectRequest req)
    {
        if (req.DeviceId == Guid.Empty || string.IsNullOrWhiteSpace(req.TrustKey))
            return BadRequest(new { error = "device_id_and_trust_key_required" });

        if (!await trust.VerifyAsync(req.DeviceId, req.TrustKey))
            return Unauthorized(new { error = "invalid_trust" });

        var d = await devices.GetAsync(req.DeviceId);
        if (d is null) return NotFound(new { error = "device_not_found" });

        var token = jwt.IssueForDevice(d.Id, d.Name);
        return Ok(new ConnectResponse(token, 60 * 60, d.Name));
    }

    private async Task BroadcastDeviceList()
    {
        var all = await devices.AllAsync();
        var actives = await sessions.ActiveByDeviceAsync();
        var dto = all.Select(d => devices.ToDto(
            d, actives.TryGetValue(d.Id, out var s) ? SessionService.ConnectedFromSession(s) : null
        )).ToArray();
        await hub.Clients.All.SendAsync("DeviceListUpdated", dto);
    }
}
