using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RemoteDesktop.Models;
using RemoteDesktop.Services;

namespace RemoteDesktop.Controllers;

[ApiController]
[Authorize(Roles = "admin,user")]
[Route("api/users")]
public class UsersController(UserService users) : ControllerBase
{
    public record CreateUserRequest(string Username, string Password, string DisplayName, string? Email, string Role);
    public record UpdateUserRequest(string DisplayName, string? Email, string Role);
    public record PasswordRequest(string Password);

    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var id = CurrentUserId();
        if (id is null) return Unauthorized();
        var u = await users.FindByIdAsync(id.Value);
        return u is null ? Unauthorized() : Ok(UserService.ToDto(u));
    }

    [HttpPut("me/password")]
    public async Task<IActionResult> ChangeOwnPassword([FromBody] PasswordRequest req)
    {
        var id = CurrentUserId();
        if (id is null) return Unauthorized();
        try
        {
            return await users.ChangePasswordAsync(id.Value, req.Password) ? NoContent() : NotFound();
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> List() =>
        Ok((await users.AllAsync()).Select(UserService.ToDto).ToArray());

    [HttpPost]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest req)
    {
        if (!TryParseRole(req.Role, out var role)) return BadRequest(new { error = "invalid_role" });
        try
        {
            var u = await users.CreateAsync(req.Username, req.Password, req.DisplayName, req.Email, role);
            return CreatedAtAction(nameof(Me), new { id = u.Id }, UserService.ToDto(u));
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { error = ex.Message }); }
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateUserRequest req)
    {
        if (!TryParseRole(req.Role, out var role)) return BadRequest(new { error = "invalid_role" });

        var target = await users.FindByIdAsync(id);
        if (target is null) return NotFound();
        if (target.Role == UserRole.Admin && role != UserRole.Admin && await users.CountAdminsAsync() == 1)
            return BadRequest(new { error = "cannot_demote_last_admin" });

        try
        {
            var u = await users.UpdateAsync(id, req.DisplayName, req.Email, role);
            return u is null ? NotFound() : Ok(UserService.ToDto(u));
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPut("{id:guid}/password")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> ResetPassword(Guid id, [FromBody] PasswordRequest req)
    {
        try
        {
            return await users.ChangePasswordAsync(id, req.Password) ? NoContent() : NotFound();
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Delete(Guid id)
    {
        if (CurrentUserId() == id) return BadRequest(new { error = "cannot_delete_self" });

        var target = await users.FindByIdAsync(id);
        if (target is null) return NotFound();
        if (target.Role == UserRole.Admin && await users.CountAdminsAsync() == 1)
            return BadRequest(new { error = "cannot_delete_last_admin" });

        return await users.DeleteAsync(id) ? NoContent() : NotFound();
    }

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? User.FindFirst("sub")?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    private static bool TryParseRole(string? value, out UserRole role)
    {
        role = UserRole.User;
        if (string.IsNullOrWhiteSpace(value)) return false;
        return Enum.TryParse<UserRole>(value, ignoreCase: true, out role)
               && Enum.IsDefined(typeof(UserRole), role);
    }
}
