package com.pluv.app

import android.app.Application
import com.pluv.app.data.PluvDatabase
import com.pluv.app.sync.SyncScheduler

class PluvApplication : Application() {
    val database by lazy { PluvDatabase.build(this) }

    override fun onCreate() {
        super.onCreate()
        SyncScheduler.schedulePeriodic(this)
    }
}
