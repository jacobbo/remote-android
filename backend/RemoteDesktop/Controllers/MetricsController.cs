using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RemoteDesktop.Models;
using RemoteDesktop.Services;

namespace RemoteDesktop.Controllers;

[ApiController]
[Authorize(Roles = "admin,user")]
[Route("api/metrics")]
public class MetricsController(
    DeviceManagerService devices,
    SessionService sessions,
    ObservabilityService observability) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Summary()
    {
        var all = await devices.AllAsync();
        var actives = await sessions.ActiveByDeviceAsync();
        var summary = observability.BuildSummary(
            allDeviceIds: all.Select(d => d.Id),
            onlineCount: all.Count(d => d.Status == DeviceStatus.Online),
            activeSessionCount: actives.Count);
        return Ok(summary);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Device(Guid id)
    {
        if (await devices.GetAsync(id) is null) return NotFound();
        return Ok(observability.ForDevice(id));
    }
}
