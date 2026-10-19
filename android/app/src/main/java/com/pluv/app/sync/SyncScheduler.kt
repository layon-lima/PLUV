package com.pluv.app.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object SyncScheduler {
    private fun conditions() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun scheduleNow(context: Context) {
        val work = OneTimeWorkRequestBuilder<PluvSyncWorker>()
            .setConstraints(conditions())
            .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork("pluv-push-pull", ExistingWorkPolicy.KEEP, work)
    }

    fun schedulePeriodic(context: Context) {
        val work = PeriodicWorkRequestBuilder<PluvSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(conditions()).build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniquePeriodicWork("pluv-periodic", ExistingPeriodicWorkPolicy.KEEP, work)
    }
}
