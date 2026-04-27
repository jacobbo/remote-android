using Microsoft.AspNetCore.Mvc;
using RemoteDesktop.Services;

namespace RemoteDesktop.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(UserService users, JwtService jwt) : ControllerBase
{
    public record LoginRequest(string Username, string Password);
    public record LoginResponse(string Token, UserResponse User);
    public record UserResponse(Guid Id, string Username, string DisplayName, string? Email, string Role);

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { error = "username and password are required" });

        var user = await users.FindByUsernameAsync(req.Username);
        if (user is null || !users.Verify(user, req.Password))
            return Unauthorized(new { error = "invalid_credentials" });

        var token = jwt.Issue(user);
        var dto = UserService.ToDto(user);
        return Ok(new LoginResponse(token, new UserResponse(dto.Id, dto.Username, dto.DisplayName, dto.Email, dto.Role)));
    }
}
