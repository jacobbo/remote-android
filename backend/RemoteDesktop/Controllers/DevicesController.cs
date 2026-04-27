using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using RemoteDesktop.Hubs;
using RemoteDesktop.Models;
using RemoteDesktop.Services;

namespace RemoteDesktop.Controllers;

[ApiController]
[Authorize(Roles = "admin,user")]
[Route("api/devices")]
public class DevicesController(
    DeviceManagerService devices,
    SessionService sessions,
    PairingService pairing,
    DeviceTrustService trust,
    WebRtcSignalingService signaling,
    ObservabilityService observability,
    IConfiguration config,
    IHubContext<ControlHub> hub,
    IHubContext<AgentHub> agentHub) : ControllerBase
{
    public record StartPairResponse(string Token, string Uri, long ExpiresAt, int ExpiresInSeconds);
    public record RotateTrustResponse(string TrustKey);

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var all = await devices.AllAsync();
        var actives = await sessions.ActiveByDeviceAsync();
        var list = all.Select(d =>
            devices.ToDto(d, actives.TryGetValue(d.Id, out var s) ? SessionService.ConnectedFromSession(s) : null)
        ).ToArray();
        return Ok(list);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var d = await devices.GetAsync(id);
        if (d is null) return NotFound();
        var active = await sessions.ActiveForAsync(id);
        return Ok(devices.ToDto(d, SessionService.ConnectedFromSession(active)));
    }

    [HttpGet("{id:guid}/sessions")]
    public async Task<IActionResult> Sessions(Guid id)
    {
        if (await devices.GetAsync(id) is null) return NotFound();
        var list = (await sessions.RecentForDeviceAsync(id)).Select(SessionService.ToDto).ToArray();
        return Ok(list);
    }

    [HttpPost("pair/start")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> StartPair()
    {
        if (await devices.CountAsync() >= DeviceManagerService.MaxDevices)
            return Conflict(new { error = "max_devices_reached" });
        var p = pairing.Issue();
        var hostPort = ResolvePairingHostPort();
        var uri = $"rdpair://{hostPort}/pair?token={p.Token}";
        return Ok(new StartPairResponse(
            p.Token,
            uri,
            p.ExpiresAt.ToUnixTimeMilliseconds(),
            (int)Math.Max(0, (p.ExpiresAt - DateTimeOffset.UtcNow).TotalSeconds)));
    }

    [HttpDelete("pair/{token}")]
    [Authorize(Roles = "admin")]
    public IActionResult CancelPair(string token)
    {
        pairing.Cancel(token);
        return NoContent();
    }

    [HttpPost("{id:guid}/disconnect")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> ForceDisconnect(Guid id)
    {
        var d = await devices.GetAsync(id);
        if (d is null) return NotFound();
        var active = await sessions.ActiveForAsync(id);
        if (active is not null)
        {
            await sessions.EndAsync(active.Id, DisconnectReason.Admin);
            await hub.Clients.All.SendAsync("SessionEnded", id, "admin");
            await BroadcastDeviceList();
        }
        return NoContent();
    }

    [HttpPost("{id:guid}/revoke")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Revoke(Guid id)
    {
        var d = await devices.GetAsync(id);
        if (d is null) return NotFound();
        await trust.RevokeAsync(id);

        // End any active viewer session so the browser returns to detail view.
        var active = await sessions.ActiveForAsync(id);
        if (active is not null)
        {
            await sessions.EndAsync(active.Id, DisconnectReason.Admin);
            await hub.Clients.All.SendAsync("SessionEnded", id, "revoked");
        }

        // Push the Revoked signal to the agent itself — the phone-side handler
        // unpairs and stops the foreground service. Trust is already revoked
        // in the DB so any reconnect attempt would also fail at /api/agent/connect.
        var agentConn = signaling.AgentOf(id);
        if (agentConn is not null)
            await agentHub.Clients.Client(agentConn).SendAsync("Revoked");

        await BroadcastDeviceList();
        return NoContent();
    }

    [HttpPost("{id:guid}/rotate")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> RotateTrust(Guid id)
    {
        var d = await devices.GetAsync(id);
        if (d is null) return NotFound();
        var issued = await trust.RotateAsync(id);
        return Ok(new RotateTrustResponse(issued.Key));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var d = await devices.GetAsync(id);
        if (d is null) return NotFound();
        var active = await sessions.ActiveForAsync(id);
        if (active is not null)
        {
            await sessions.EndAsync(active.Id, DisconnectReason.Admin);
            await hub.Clients.All.SendAsync("SessionEnded", id, "removed");
        }
        await devices.DeleteAsync(id);
        observability.Forget(id);
        await BroadcastDeviceList();
        return NoContent();
    }

    private string ResolvePairingHostPort()
    {
        // Pairing__BaseUrl is the LAN-reachable URL the agent will hit
        // (e.g. http://192.168.1.10:5000). When unset — typical for `dotnet run`
        // on the dev box — fall back to the request's host header. Production
        // deployments behind Cloudflare MUST set Pairing__BaseUrl, otherwise
        // the QR would point at the public proxy address that the phone on the
        // LAN cannot reach.
        var configured = config["Pairing:BaseUrl"];
        if (!string.IsNullOrWhiteSpace(configured) &&
            Uri.TryCreate(configured, UriKind.Absolute, out var parsed))
        {
            return parsed.IsDefaultPort ? parsed.Host : $"{parsed.Host}:{parsed.Port}";
        }
        return Request.Host.ToString();
    }

    private async Task BroadcastDeviceList()
    {
        var all = await devices.AllAsync();
        var actives = await sessions.ActiveByDeviceAsync();
        var dto = all.Select(d =>
            devices.ToDto(d, actives.TryGetValue(d.Id, out var s) ? SessionService.ConnectedFromSession(s) : null)
        ).ToArray();
        await hub.Clients.All.SendAsync("DeviceListUpdated", dto);
    }
}
