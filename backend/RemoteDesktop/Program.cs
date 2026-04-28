using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using RemoteDesktop.Data;
using RemoteDesktop.Hubs;
using RemoteDesktop.Services;

var builder = WebApplication.CreateBuilder(args);

// EF Core / PostgreSQL
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.");
builder.Services.AddDbContextFactory<AppDbContext>(options => options.UseNpgsql(connectionString));

// Services
var jwtService = new JwtService(builder.Configuration);
builder.Services.AddSingleton(jwtService);
builder.Services.AddSingleton<UserService>();
builder.Services.AddSingleton<DeviceManagerService>();
builder.Services.AddSingleton<SessionService>();
builder.Services.AddSingleton<DeviceTrustService>();
builder.Services.AddSingleton<PairingService>();
builder.Services.AddSingleton<InputRelayService>();
builder.Services.AddSingleton<WebRtcSignalingService>();
builder.Services.AddSingleton<TurnService>();

// Controllers + SignalR
builder.Services.AddControllers();
builder.Services.AddSignalR();

// JWT auth
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = jwtService.ValidationParameters;

        // Allow SignalR WebSockets to authenticate via access_token query param.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var accessToken = ctx.Request.Query["access_token"];
                var path = ctx.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                    ctx.Token = accessToken;
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();

// CORS for the frontend dev server
var corsOrigin = Environment.GetEnvironmentVariable("CORS_ORIGIN") ?? "http://localhost:3000";
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(p => p
        .WithOrigins(corsOrigin.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

var app = builder.Build();

// Apply migrations and seed on startup. The connection may not be immediately
// available behind docker-compose's "depends_on: condition: service_healthy",
// but a brief retry loop covers any flakiness from the postgres container
// finishing its WAL bring-up just after the healthcheck reports OK.
using (var scope = app.Services.CreateScope())
{
    var dbf = scope.ServiceProvider.GetRequiredService<IDbContextFactory<AppDbContext>>();
    var log = app.Services.GetRequiredService<ILogger<Program>>();
    var attempts = 0;
    while (true)
    {
        try
        {
            await using var db = await dbf.CreateDbContextAsync();
            await db.Database.MigrateAsync();
            break;
        }
        catch (Exception ex) when (attempts++ < 10)
        {
            log.LogWarning(ex, "Database not ready (attempt {Attempt}/10), retrying in 2s...", attempts);
            await Task.Delay(TimeSpan.FromSeconds(2));
        }
    }
    await Seed.RunAsync(scope.ServiceProvider);
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));
app.MapControllers();
app.MapHub<ControlHub>("/hubs/control");
app.MapHub<AgentHub>("/hubs/agent");

app.Run();
