package com.remotedesktop.agent.control

import com.remotedesktop.agent.models.ApiError
import com.remotedesktop.agent.models.ConnectRequest
import com.remotedesktop.agent.models.ConnectResponse
import com.remotedesktop.agent.models.PairRequest
import com.remotedesktop.agent.models.PairResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class AgentApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }

    suspend fun pair(req: PairRequest): PairResponse =
        post("/api/agent/pair", json.encodeToString(PairRequest.serializer(), req)) { body ->
            json.decodeFromString(PairResponse.serializer(), body)
        }

    suspend fun connect(req: ConnectRequest): ConnectResponse =
        post("/api/agent/connect", json.encodeToString(ConnectRequest.serializer(), req)) { body ->
            json.decodeFromString(ConnectResponse.serializer(), body)
        }

    private suspend fun <T> post(path: String, body: String, parse: (String) -> T): T = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .post(body.toRequestBody(JSON_MEDIA))
            .build()
        client.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                val err = runCatching { json.decodeFromString(ApiError.serializer(), raw).error }.getOrNull()
                throw ApiException(res.code, err ?: res.message.ifEmpty { "http_${res.code}" })
            }
            parse(raw)
        }
    }

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}

class ApiException(val status: Int, message: String) : RuntimeException(message)
