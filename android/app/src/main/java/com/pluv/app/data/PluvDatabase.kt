package com.pluv.app.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "gauges")
data class Gauge(
    @PrimaryKey val id: String,
    val name: String,
    val location: String,
    val description: String,
    val version: Long = 0,
    val deleted: Boolean = false
)

@Entity(tableName = "readings")
data class Reading(
    @PrimaryKey val id: String,
    val gaugeId: String,
    val amountMm: Double,
    val observedAt: String,
    val notes: String,
    val version: Long = 0,
    val deleted: Boolean = false
)

@Entity(tableName = "outbox")
data class PendingOperation(
    @PrimaryKey val id: String,
    val entityId: String,
    val kind: String,
    val action: String,
    val baseVersion: Long,
    val payload: String,
    val createdAt: Long,
    val conflict: String = "",
    val serverPayload: String = ""
)

@Entity(tableName = "sync_state")
data class SyncState(@PrimaryKey val id: Int = 1, val cursor: Long = 0)

@Dao
interface PluvDao {
    @Query("SELECT * FROM gauges WHERE deleted = 0 ORDER BY name COLLATE NOCASE")
    fun observeGauges(): Flow<List<Gauge>>

    @Query("SELECT * FROM readings WHERE deleted = 0 ORDER BY observedAt DESC")
    fun observeReadings(): Flow<List<Reading>>

    @Query("SELECT * FROM outbox ORDER BY rowid ASC")
    fun observePending(): Flow<List<PendingOperation>>

    @Query("SELECT * FROM gauges WHERE id = :id")
    suspend fun getGauge(id: String): Gauge?

    @Query("SELECT * FROM readings WHERE gaugeId = :gaugeId AND deleted = 0")
    suspend fun getReadingsForGauge(gaugeId: String): List<Reading>

    @Query("SELECT * FROM readings WHERE id = :id")
    suspend fun getReading(id: String): Reading?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putGauge(gauge: Gauge)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putReading(reading: Reading)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putPending(operation: PendingOperation)

    @Query("SELECT * FROM outbox ORDER BY rowid ASC LIMIT 1")
    suspend fun nextPending(): PendingOperation?

    @Query("SELECT COUNT(*) FROM outbox WHERE entityId = :entityId")
    suspend fun pendingCount(entityId: String): Long

    @Query("DELETE FROM outbox WHERE id = :opId")
    suspend fun deletePending(opId: String)

    @Query("UPDATE outbox SET conflict = :error, serverPayload = :serverPayload WHERE id = :opId")
    suspend fun markConflict(opId: String, error: String, serverPayload: String)

    @Query("DELETE FROM outbox WHERE entityId = :entityId")
    suspend fun deletePendingForEntity(entityId: String)

    @Query("SELECT * FROM sync_state WHERE id = 1")
    suspend fun syncState(): SyncState?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putSyncState(state: SyncState)
}

@Database(
    entities = [Gauge::class, Reading::class, PendingOperation::class, SyncState::class],
    version = 1,
    exportSchema = false
)
abstract class PluvDatabase : RoomDatabase() {
    abstract fun dao(): PluvDao

    companion object {
        @Volatile private var instance: PluvDatabase? = null
        fun build(context: Context): PluvDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(context.applicationContext, PluvDatabase::class.java, "pluv-offline.db")
                    .build().also { instance = it }
            }
    }
}
