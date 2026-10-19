package com.pluv.app.sync

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class PluvApiException(val httpStatus: Int, message: String) : IOException(message)

class PluvApi(private val baseUrl: String, private val token: String? = null) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .build()

    fun send(method: String, path: String, payload: JSONObject? = null): JSONObject {
        require(baseUrl.startsWith("https://"))
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path)
        if (!token.isNullOrBlank()) builder.header("Authorization", "Bearer $token")
        val body = (payload ?: JSONObject()).toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = builder.method(method, if (method == "GET") null else body).build()
        client.newCall(request).execute().use { response ->
            val result = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw PluvApiException(response.code, "HTTP "+response.code+": "+result.take(250))
            return if (result.isBlank()) JSONObject() else JSONObject(result)
        }
    }
}
