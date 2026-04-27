package com.remotedesktop.agent.pair

import android.net.Uri

// Parses the QR payload the admin's web UI generates:
//
//   rdpair://<host>:<port>/pair?token=<uuid>
//
// `host` is the LAN address the agent will hit (the same machine the admin's
// browser is talking to, but addressed by its phone-reachable IP set via the
// backend's Pairing__BaseUrl env var). The HTTP scheme is implicit — pairing
// always happens on the same WiFi as the server.
data class PairUri(val baseUrl: String, val token: String) {
    companion object {
        const val SCHEME = "rdpair"

        fun parse(raw: String): PairUri? {
            val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return null
            if (!uri.scheme.equals(SCHEME, ignoreCase = true)) return null
            val host = uri.host?.takeIf { it.isNotBlank() } ?: return null
            val token = uri.getQueryParameter("token")?.takeIf { it.isNotBlank() } ?: return null
            val port = uri.port
            val authority = if (port > 0) "$host:$port" else host
            return PairUri("http://$authority", token)
        }
    }
}
