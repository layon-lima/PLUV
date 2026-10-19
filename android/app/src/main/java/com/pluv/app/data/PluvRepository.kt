package com.pluv.app.data

import android.content.Context
import androidx.room.withTransaction
import com.pluv.app.sync.SyncScheduler
import java.time.OffsetDateTime
import java.util.UUID
import org.json.JSONObject

class PluvRepository(private val context: Context, private val db: PluvDatabase) {
    val gauges = db.dao().observeGauges()
    val readings = db.dao().observeReadings()
    val pending = db.dao().observePending()

    suspend fun saveGauge(id: String?, name: String, location: String, description: String) {
        require(name.isNotBlank())
        val entityId = id ?: UUID.randomUUID().toString()
        db.withTransaction {
            val original = db.dao().getGauge(entityId)
            val count = db.dao().pendingCount(entityId)
            val base = (original?.version ?: 0) + count
            val value = Gauge(entityId, name.trim(), location.trim(), description.trim(),
                original?.version ?: 0, false)
            db.dao().putGauge(value)
            db.dao().putPending(
                PendingOperation(
                    UUID.randomUUID().toString(), entityId, "gauge", "upsert", base,
                    JSONObject().put("name", value.name).put("location", value.location)
                        .put("description", value.description).toString(),
                    System.currentTimeMillis()
                )
            )
        }
        SyncScheduler.scheduleNow(context)
    }

    suspend fun deleteGauge(id: String) {
        db.withTransaction {
            val existing = db.dao().getGauge(id) ?: return@withTransaction
            if (existing.deleted) return@withTransaction
            // Apaga primeiro as medições (tombstones), preservando consistência entre aparelhos.
            for (reading in db.dao().getReadingsForGauge(id)) {
                val readingBase = reading.version + db.dao().pendingCount(reading.id)
                db.dao().putReading(reading.copy(deleted = true))
                db.dao().putPending(
                    PendingOperation(UUID.randomUUID().toString(), reading.id, "reading",
                        "delete", readingBase, "{}", System.currentTimeMillis())
                )
            }
            val base = existing.version + db.dao().pendingCount(id)
            db.dao().putGauge(existing.copy(deleted = true))
            db.dao().putPending(PendingOperation(UUID.randomUUID().toString(), id,
                "gauge", "delete", base, "{}", System.currentTimeMillis()))
        }
        SyncScheduler.scheduleNow(context)
    }

    suspend fun saveReading(id: String?, gaugeId: String, mm: Double, whenAt: String, notes: String) {
        require(mm.isFinite() && mm >= 0 && mm <= 10000)
        OffsetDateTime.parse(whenAt)
        val entityId = id ?: UUID.randomUUID().toString()
        db.withTransaction {
            val original = db.dao().getReading(entityId)
            val base = (original?.version ?: 0) + db.dao().pendingCount(entityId)
            val item = Reading(entityId, gaugeId, mm, whenAt, notes.trim(), original?.version ?: 0, false)
            db.dao().putReading(item)
            val data = JSONObject()
                .put("gauge_id", item.gaugeId)
                .put("amount_mm", item.amountMm)
                .put("observed_at", item.observedAt)
                .put("notes", item.notes)
            db.dao().putPending(PendingOperation(UUID.randomUUID().toString(), entityId,
                "reading", "upsert", base, data.toString(), System.currentTimeMillis()))
        }
        SyncScheduler.scheduleNow(context)
    }

    suspend fun deleteReading(id: String) {
        db.withTransaction {
            val item = db.dao().getReading(id) ?: return@withTransaction
            if (item.deleted) return@withTransaction
            val base = item.version + db.dao().pendingCount(id)
            db.dao().putReading(item.copy(deleted = true))
            db.dao().putPending(PendingOperation(UUID.randomUUID().toString(), id,
                "reading", "delete", base, "{}", System.currentTimeMillis()))
        }
        SyncScheduler.scheduleNow(context)
    }
}
