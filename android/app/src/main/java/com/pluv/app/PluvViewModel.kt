package com.pluv.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.pluv.app.data.Gauge
import com.pluv.app.data.PluvRepository
import com.pluv.app.data.Reading
import com.pluv.app.data.PendingOperation
import com.pluv.app.sync.PluvApi
import com.pluv.app.sync.SecureConfig
import com.pluv.app.sync.SyncScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class PluvViewModel(app: Application) : AndroidViewModel(app) {
    private val db = (app as PluvApplication).database
    private val repo = PluvRepository(app, db)
    private val config = SecureConfig(app)

    val gauges: Flow<List<Gauge>> = repo.gauges
    val readings: Flow<List<Reading>> = repo.readings
    val pending = repo.pending

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy
    private val _connectedUser = MutableStateFlow(config.username)
    val connectedUser: StateFlow<String> = _connectedUser

    fun savedServer(): String = config.baseUrl
    fun canWrite(): Boolean = config.role != "reader"

    fun clearMessage() { _message.value = null }

    fun saveGauge(id: String?, name: String, location: String, description: String) = launchSafely {
        repo.saveGauge(id, name, location, description)
        _message.value = "Pluviômetro salvo no celular"
    }

    fun deleteGauge(id: String) = launchSafely {
        repo.deleteGauge(id)
        _message.value = "Pluviômetro excluído no celular"
    }

    fun saveReading(id: String?, gaugeId: String, mm: Double, at: String, notes: String) = launchSafely {
        repo.saveReading(id, gaugeId, mm, at, notes)
        _message.value = "Medição salva no celular"
    }

    fun deleteReading(id: String) = launchSafely {
        repo.deleteReading(id)
        _message.value = "Medição excluída no celular"
    }

    fun login(server: String, username: String, password: String) {
        viewModelScope.launch {
            _busy.value = true
            try {
                val trimmed = server.trim().trimEnd('/')
                require(trimmed.startsWith("https://")) { "Informe um servidor HTTPS." }
                val payload = JSONObject().put("username", username).put("password", password)
                val answer = withContext(Dispatchers.IO) {
                    PluvApi(trimmed).send("POST", "/auth/login", payload)
                }
                config.baseUrl = trimmed
                config.storeToken(answer.getString("access_token"))
                config.username = username.trim()
                config.role = answer.getString("role")
                _connectedUser.value = config.username
                _message.value = "Conectado. Sincronização agendada."
                SyncScheduler.scheduleNow(getApplication())
            } catch (e: Exception) {
                _message.value = "Não foi possível conectar: " + (e.message ?: "erro")
            } finally {
                _busy.value = false
            }
        }
    }

    fun synchronize() {
        SyncScheduler.scheduleNow(getApplication())
        _message.value = "Sincronização agendada para quando houver internet."
    }

    fun resolveConflict(op: PendingOperation, keepLocal: Boolean) = launchSafely {
        repo.resolveConflict(op.id, keepLocal)
        _message.value = if (keepLocal)
            "Sua alteração foi preparada para reenviar."
        else "Versão do servidor aplicada ao celular."
    }

    private fun launchSafely(action: suspend () -> Unit) {
        viewModelScope.launch {
            try { action() }
            catch (e: Exception) { _message.value = e.message ?: "Não foi possível salvar" }
        }
    }
}
