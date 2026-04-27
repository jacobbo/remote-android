namespace RemoteDesktop.Models;

public record InputEvent(
    string Type,
    double? X = null,
    double? Y = null,
    double? StartX = null,
    double? StartY = null,
    double? EndX = null,
    double? EndY = null,
    int? DurationMs = null,
    double? DeltaY = null,
    string? KeyCode = null
);
