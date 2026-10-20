package com.pluv.app

import android.app.Application

/**
 * PLUV nativo usa o mesmo PWA da VPS via WebView.
 * Removida a sincronizacao antiga por Worker para evitar erros de login e
 * manter uma unica fila offline (IndexedDB) por dispositivo.
 */
class PluvApplication : Application()
