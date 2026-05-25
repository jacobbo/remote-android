using System.Collections.Concurrent;

namespace RemoteDesktop.Services;

public class PairingService
{
    public static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<string, DateTimeOffset> _tokens = new();

    public PairingToken Issue()
    {
        Sweep();
        var token = Guid.NewGuid().ToString("N");
        var expiresAt = DateTimeOffset.UtcNow.Add(Ttl);
        _tokens[token] = expiresAt;
        return new PairingToken(token, expiresAt);
    }

    public bool Consume(string token)
    {
        Sweep();
        if (!_tokens.TryGetValue(token, out var exp)) return false;
        if (exp <= DateTimeOffset.UtcNow) { _tokens.TryRemove(token, out _); return false; }
        return _tokens.TryRemove(token, out _);
    }

    public bool Cancel(string token) => _tokens.TryRemove(token, out _);

    private void Sweep()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var kv in _tokens)
            if (kv.Value <= now) _tokens.TryRemove(kv.Key, out _);
    }
}

public record PairingToken(string Token, DateTimeOffset ExpiresAt);
