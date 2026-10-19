package com.pluv.app.sync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** A senha nao e persistida. Token cifrado com a chave do Android Keystore. */
class SecureConfig(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("pluv_connection", Context.MODE_PRIVATE)
    private val alias = "pluv_access_token_v1"
    private val defaultApiUrl = "https://pluv.fazendanovohorizonte.com"

    var baseUrl: String
        get() = prefs.getString("base_url", defaultApiUrl) ?: defaultApiUrl
        set(value) {
            val cleaned = value.trim().trimEnd('/')
            val url = cleaned.toHttpUrlOrNull()
            require(url != null && url.scheme == "https" && url.host.isNotBlank()) {
                "Informe um endereco HTTPS valido"
            }
            prefs.edit().putString("base_url", cleaned).apply()
        }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore")
        store.load(null)
        val found = store.getKey(alias, null)
        if (found is SecretKey) return found
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    fun storeToken(token: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val bytes = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs.edit().putString("token_data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            .putString("token_iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
    }

    fun token(): String? {
        return try {
            val data = prefs.getString("token_data", null) ?: return null
            val iv = prefs.getString("token_iv", null) ?: return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (_: Exception) { null }
    }

    fun clearToken() {
        prefs.edit().remove("token_data").remove("token_iv").remove("username").remove("role").apply()
    }

    var username: String
        get() = prefs.getString("username", "") ?: ""
        set(value) { prefs.edit().putString("username", value).apply() }

    var role: String
        get() = prefs.getString("role", "") ?: ""
        set(value) { prefs.edit().putString("role", value).apply() }
}
