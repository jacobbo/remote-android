package com.remotedesktop.agent.pair

import android.net.Uri

// Parses the QR payload the admin's web UI generates:
//
//   rdpair://<host>[:<port>]/pair?token=<uuid>    → http  (LAN dev)
//   rdpairs://<host>[:<port>]/pair?token=<uuid>   → https (public deploy)
//
// The 's' suffix mirrors http→https; the backend picks which scheme to emit
// based on the scheme of Pairing__BaseUrl. The agent dials the produced
// baseUrl unchanged for REST + SignalR (which upgrades to wss automatically
// when the URL is https).
data class PairUri(val baseUrl: String, val token: String) {
    companion object {
        const val SCHEME_HTTP = "rdpair"
        const val SCHEME_HTTPS = "rdpairs"

        fun parse(raw: String): PairUri? {
            val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return null
            val transport = when {
                uri.scheme.equals(SCHEME_HTTPS, ignoreCase = true) -> "https"
                uri.scheme.equals(SCHEME_HTTP, ignoreCase = true) -> "http"
                else -> return null
            }
            val host = uri.host?.takeIf { it.isNotBlank() } ?: return null
            val token = uri.getQueryParameter("token")?.takeIf { it.isNotBlank() } ?: return null
            val port = uri.port
            val authority = if (port > 0) "$host:$port" else host
            return PairUri("$transport://$authority", token)
        }
    }
}
