package com.pluv.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * PLUV Android = a mesma interface web e a mesma API que o PWA.
 * Site oficial e banco ficam na VPS; IndexedDB/Service Worker ficam no aparelho.
 * Nenhuma URL de terceiros pode executar JavaScript dentro deste WebView.
 */
class MainActivity : ComponentActivity() {
    private companion object {
        const val ORIGIN = "https://pluv.fazendanovohorizonte.com"
        const val HOST = "pluv.fazendanovohorizonte.com"
    }

    private lateinit var web: WebView
    private var importCallback: ValueCallback<Array<Uri>>? = null
    private var pendingBackup: ByteArray? = null
    private var pendingLocationOrigin: String? = null
    private var pendingLocationCallback: GeolocationPermissions.Callback? = null

    // O GPS so e solicitado pelo formulario apos toque do usuario em um pluviometro.
    // Depois da autorizacao, leituras posteriores podem ocorrer sem novo prompt.
    private val requestLocation = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val origin = pendingLocationOrigin
        val callback = pendingLocationCallback
        pendingLocationOrigin = null
        pendingLocationCallback = null
        if (origin != null && callback != null) {
            callback.invoke(origin, permissions.values.any { it }, false)
        }
    }


    private val importDocument = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        importCallback?.onReceiveValue(uri?.let { arrayOf(it) })
        importCallback = null
    }

    private val exportDocument = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        val content = pendingBackup
        pendingBackup = null
        if (uri != null && content != null) {
            try {
                contentResolver.openOutputStream(uri)?.use { stream ->
                    stream.write(content)
                } ?: error("Não foi possível abrir o arquivo")
                Toast.makeText(this, "Backup PLUV salvo", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Não foi possível salvar o backup", Toast.LENGTH_LONG).show()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.parseColor("#F3F7F8")
        window.navigationBarColor = Color.parseColor("#F3F7F8")
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#F3F7F8"))
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            setGeolocationEnabled(true)
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)

        // Disponibiliza SOMENTE exportação de JSON; sem acesso arbitrário a arquivos.
        web.addJavascriptInterface(BackupBridge(), "PLUV_ANDROID")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?, request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return true
                if (uri.scheme == "https" && uri.host == HOST) return false
                if (uri.scheme == "https") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    } catch (_: Exception) { /* URL externa indisponível */ }
                }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                if (origin == null || callback == null) return
                val url = Uri.parse(origin)
                // GPS apenas para o PLUV oficial, nunca para sites externos.
                if (url.scheme != "https" || url.host != HOST) {
                    callback.invoke(origin, false, false)
                    return
                }
                val fine = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                val coarse = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.ACCESS_COARSE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                if (fine || coarse) {
                    callback.invoke(origin, true, false)
                } else {
                    pendingLocationOrigin?.let { previous ->
                        pendingLocationCallback?.invoke(previous, false, false)
                    }
                    pendingLocationOrigin = origin
                    pendingLocationCallback = callback
                    try {
                        requestLocation.launch(arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        ))
                    } catch (_: Exception) {
                        callback.invoke(origin, false, false)
                        pendingLocationOrigin = null
                        pendingLocationCallback = null
                    }
                }
            }
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: WebChromeClient.FileChooserParams?
            ): Boolean {
                importCallback?.onReceiveValue(null)
                importCallback = callback
                return try {
                    importDocument.launch(arrayOf("application/json", "text/plain", "*/*"))
                    true
                } catch (_: Exception) {
                    importCallback?.onReceiveValue(null)
                    importCallback = null
                    false
                }
            }
        }

        val frame = FrameLayout(this)
        frame.addView(
            web,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        // Respeita as barras do Android 15+ para não cobrir o botão flutuante.
        ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(frame)
        web.loadUrl(ORIGIN + "/")

        // Tecla/gesto Voltar: fecha modal, volta um pluviômetro, só então sai.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript(
                    "Boolean(window.PLUV_NATIVE_BACK && window.PLUV_NATIVE_BACK())"
                ) { handled ->
                    if (handled != "true") {
                        if (web.canGoBack()) web.goBack()
                        else moveTaskToBack(true)
                    }
                }
            }
        })
    }

    private inner class BackupBridge {
        @JavascriptInterface
        fun saveBackup(json: String) {
            // Limite de segurança contra uso excessivo de memória.
            if (json.length > 20_000_000) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Backup grande demais", Toast.LENGTH_LONG).show()
                }
                return
            }
            runOnUiThread {
                pendingBackup = json.toByteArray(Charsets.UTF_8)
                val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
                exportDocument.launch("PLUV-BACKUP-$date.json")
            }
        }
    }

    override fun onDestroy() {
        pendingLocationOrigin?.let { origin ->
            pendingLocationCallback?.invoke(origin, false, false)
        }
        pendingLocationOrigin = null
        pendingLocationCallback = null
        importCallback?.onReceiveValue(null)
        importCallback = null
        if (::web.isInitialized) {
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }
}
