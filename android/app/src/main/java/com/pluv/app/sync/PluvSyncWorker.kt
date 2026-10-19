package com.pluv.app.sync

import android.content.Context
import androidx.room.withTransaction
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.pluv.app.data.Gauge
import com.pluv.app.data.PluvDatabase
import com.pluv.app.data.Reading
import com.pluv.app.data.SyncState
import java.io.IOException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import org.json.JSONArray
import org.json.JSONObject

/** Mantem a fila de escrita ate o servidor confirmar. Nao apaga dados em erros de rede. */
class PluvSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    companion object {
        private val lock = Mutex()
    }

    override suspend fun doWork(): Result = lock.withLock {
        val config = SecureConfig(applicationContext)
        val token = config.token()
        if (token.isNullOrEmpty() || config.baseUrl.isBlank()) return@withLock Result.success()
        val api = PluvApi(config.baseUrl, token)
        val db = PluvDatabase.build(applicationContext)
        try {
            withContext(Dispatchers.IO) {
                // Serializa as operacoes por ordem de criacao; cada uma possui op_id estavel.
                while (true) {
                    val op = db.dao().nextPending() ?: break
                    if (op.conflict.isNotBlank()) return@withContext
                    val req = JSONObject().put("operations", JSONArray().put(
                        JSONObject()
                            .put("op_id", op.id)
                            .put("kind", op.kind)
                            .put("entity_id", op.entityId)
                            .put("action", op.action)
                            .put("base_version", op.baseVersion)
                            .put("data", JSONObject(op.payload))
                    ))
                    val response = api.send("POST", "/sync/push", req)
                    val item = response.getJSONArray("results").getJSONObject(0)
                    if (item.getString("status") != "accepted") {
                        db.dao().markConflict(op.id, item.optString("reason", "conflict"),
                            item.optJSONObject("server")?.toString() ?: "")
                        return@withContext
                    }
                    val acceptedVersion = item.getLong("version")
                    db.withTransaction {
                        if (op.kind == "gauge") {
                            val existing = db.dao().getGauge(op.entityId)
                            if (existing != null && existing.version < acceptedVersion)
                                db.dao().putGauge(existing.copy(version = acceptedVersion))
                        } else {
                            val existing = db.dao().getReading(op.entityId)
                            if (existing != null && existing.version < acceptedVersion)
                                db.dao().putReading(existing.copy(version = acceptedVersion))
                        }
                        db.dao().deletePending(op.id)
                    }
                }

                // O cursor avanca somente ate mudancas efetivamente aplicadas.
                // Se um item tem edicoes locais pendentes, mantemos o cursor antes dele.
                // Dessa forma alteracoes remotas nao se perdem em sincronizacoes futuras.
                while (true) {
                    val cursor = db.dao().syncState()?.cursor ?: 0
                    val response = api.send("GET", "/sync/pull?after=" + cursor + "&limit=200")
                    val changes = response.getJSONArray("changes")
                    var blockedByLocalChange = false
                    var appliedCursor = cursor

                    db.withTransaction {
                        for (i in 0 until changes.length()) {
                            val change = changes.getJSONObject(i)
                            val id = change.getString("entity_id")
                            if (db.dao().pendingCount(id) > 0) {
                                blockedByLocalChange = true
                                break
                            }

                            val payload = change.getJSONObject("data")
                            val version = payload.getLong("version")
                            val deleted = !payload.isNull("deleted_at")
                            if (change.getString("kind") == "gauge") {
                                val current = db.dao().getGauge(id)
                                if (current == null || current.version < version) {
                                    db.dao().putGauge(Gauge(
                                        id = id,
                                        name = payload.getString("name"),
                                        location = payload.optString("location"),
                                        description = payload.optString("description"),
                                        version = version, deleted = deleted
                                    ))
                                }
                            } else {
                                val current = db.dao().getReading(id)
                                if (current == null || current.version < version) {
                                    db.dao().putReading(Reading(
                                        id = id,
                                        gaugeId = payload.getString("gauge_id"),
                                        amountMm = payload.getDouble("amount_mm"),
                                        observedAt = payload.getString("observed_at"),
                                        notes = payload.optString("notes"),
                                        version = version, deleted = deleted
                                    ))
                                }
                            }
                            appliedCursor = change.getLong("cursor")
                        }
                        db.dao().putSyncState(SyncState(cursor = appliedCursor))
                    }
                    if (blockedByLocalChange || !response.getBoolean("has_more") || appliedCursor == cursor) break
                }
            }
            Result.success()
        } catch (e: PluvApiException) {
            if (e.httpStatus == 401 || e.httpStatus == 403) Result.failure()
            else Result.retry()
        } catch (_: IOException) {
            Result.retry()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
