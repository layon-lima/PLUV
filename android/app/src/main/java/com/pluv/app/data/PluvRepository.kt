package com.pluv.app.data

import android.content.Context
import androidx.room.withTransaction
import com.pluv.app.sync.SyncScheduler
import java.time.OffsetDateTime
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.UUID
import org.json.JSONObject

class PluvRepository(private val context: Context, private val db: PluvDatabase) {
    val gauges = db.dao().observeGauges()
    val readings = db.dao().observeReadings()
    val pending = db.dao().observePending()

    suspend fun saveGauge(id: String?, name: String, location: String, description: String) {
        require(name.isNotBlank() && name.trim().length <= 160) { "Nome deve ter ate 160 caracteres" }
        require(location.length <= 240) { "Localizacao deve ter ate 240 caracteres" }
        require(description.length <= 2000) { "Descricao deve ter ate 2000 caracteres" }
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
        require(mm.isFinite() && mm >= 0 && mm <= 10000) { "Chuva deve ficar entre 0 e 10.000 mm" }
        require(notes.length <= 2000) { "Observacoes devem ter ate 2000 caracteres" }
        val roundedMm = BigDecimal.valueOf(mm).setScale(2, RoundingMode.HALF_UP).toDouble()
        OffsetDateTime.parse(whenAt)
        val entityId = id ?: UUID.randomUUID().toString()
        db.withTransaction {
            val original = db.dao().getReading(entityId)
            val base = (original?.version ?: 0) + db.dao().pendingCount(entityId)
            val item = Reading(entityId, gaugeId, roundedMm, whenAt, notes.trim(), original?.version ?: 0, false)
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

    /**
     * Reconciliacao explicita: nunca descarta dados locais sem a escolha do usuario.
     * keepLocal = true gera nova operacao com versao do servidor; false aceita o servidor.
     */
    suspend fun resolveConflict(opId: String, keepLocal: Boolean) {
        db.withTransaction {
            val op = db.dao().getPending(opId) ?: error("Pendencia nao encontrada")
            check(op.conflict.isNotBlank()) { "Esta pendencia nao tem conflito" }
            check(op.serverPayload.isNotBlank()) {
                "O servidor nao informou o registro atual. Alteracao preservada."
            }
            val server = JSONObject(op.serverPayload)
            val version = server.getLong("version")
            val remotelyDeleted = !server.isNull("deleted_at")
            if (op.kind == "gauge") {
                val existing = db.dao().getGauge(op.entityId)
                if (keepLocal) {
                    check(existing != null) { "Pluviometro local nao encontrado" }
                    check(!remotelyDeleted || existing.deleted) {
                        "O pluviometro foi excluido no servidor; alteracao preservada."
                    }
                    db.dao().deletePendingForEntity(op.entityId)
                    db.dao().putGauge(existing.copy(version = version))
                    val payload = JSONObject().put("name", existing.name)
                        .put("location", existing.location)
                        .put("description", existing.description)
                    db.dao().putPending(PendingOperation(
                        UUID.randomUUID().toString(), op.entityId, "gauge",
                        if (existing.deleted) "delete" else "upsert", version,
                        if (existing.deleted) "{}" else payload.toString(),
                        System.currentTimeMillis()
                    ))
                } else {
                    db.dao().deletePendingForEntity(op.entityId)
                    db.dao().putGauge(Gauge(
                        id = op.entityId, name = server.getString("name"),
                        location = server.optString("location"),
                        description = server.optString("description"),
                        version = version, deleted = remotelyDeleted
                    ))
                }
            } else {
                val existing = db.dao().getReading(op.entityId)
                if (keepLocal) {
                    check(existing != null) { "Medicao local nao encontrada" }
                    check(!remotelyDeleted || existing.deleted) {
                        "A medicao foi excluida no servidor; alteracao preservada."
                    }
                    db.dao().deletePendingForEntity(op.entityId)
                    db.dao().putReading(existing.copy(version = version))
                    val payload = JSONObject().put("gauge_id", existing.gaugeId)
                        .put("amount_mm", existing.amountMm)
                        .put("observed_at", existing.observedAt)
                        .put("notes", existing.notes)
                    db.dao().putPending(PendingOperation(
                        UUID.randomUUID().toString(), op.entityId, "reading",
                        if (existing.deleted) "delete" else "upsert", version,
                        if (existing.deleted) "{}" else payload.toString(),
                        System.currentTimeMillis()
                    ))
                } else {
                    db.dao().deletePendingForEntity(op.entityId)
                    db.dao().putReading(Reading(
                        id = op.entityId, gaugeId = server.getString("gauge_id"),
                        amountMm = server.getDouble("amount_mm"),
                        observedAt = server.getString("observed_at"),
                        notes = server.optString("notes"),
                        version = version, deleted = remotelyDeleted
                    ))
                }
            }
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
