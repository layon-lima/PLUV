package com.pluv.app

import android.app.Application
import com.pluv.app.data.PluvDatabase

/**
 * O app principal e o PWA carregado no WebView.
 * Mantemos a base Room antiga apenas para compatibilidade do codigo legado
 * e eventual migracao, sem inicializar nem agendar sincronizacao antiga.
 */
class PluvApplication : Application() {
    val database by lazy { PluvDatabase.build(this) }
}
