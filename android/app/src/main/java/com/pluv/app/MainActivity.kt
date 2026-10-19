package com.pluv.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.pluv.app.data.Gauge
import com.pluv.app.data.Reading
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val deepBlue = Color(0xFF153C53)
private val blue = Color(0xFF0D7D96)
private val bg = Color(0xFFF3F7F8)
private val gray = Color(0xFF667B89)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = blue, background = bg)) {
                PluvScreen()
            }
        }
    }
}

@Composable
private fun PluvScreen(vm: PluvViewModel = viewModel()) {
    val gauges by vm.gauges.collectAsState(initial = emptyList())
    val readings by vm.readings.collectAsState(initial = emptyList())
    val pending by vm.pending.collectAsState(initial = emptyList())
    val message by vm.message.collectAsState()
    val username by vm.connectedUser.collectAsState()
    val busy by vm.busy.collectAsState()
    val snack = remember { SnackbarHostState() }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var editGauge by remember { mutableStateOf<Gauge?>(null) }
    var newGauge by remember { mutableStateOf(false) }
    var editReading by remember { mutableStateOf<Reading?>(null) }
    var newReading by remember { mutableStateOf(false) }
    var settings by remember { mutableStateOf(false) }
    var removeGauge by remember { mutableStateOf(false) }
    var removeReading by remember { mutableStateOf<Reading?>(null) }

    LaunchedEffect(message) {
        if (message != null) {
            snack.showSnackbar(message ?: "")
            vm.clearMessage()
        }
    }

    val current = gauges.firstOrNull { it.id == selected }
    val visible = readings.filter { it.gaugeId == selected }.sortedByDescending { it.observedAt }
    fun sum(id: String?): Double = readings
        .filter { id == null || it.gaugeId == id }
        .sumOf { it.amountMm }

    Scaffold(containerColor = bg, snackbarHost = { SnackbarHost(snack) }) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("💧 PLUV", color = deepBlue, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Controle de pluviômetros", color = gray, style = MaterialTheme.typography.labelSmall)
                }
                TextButton(onClick = { settings = true }) { Text("⚙ Ajustes") }
            }
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE4F3E9))) {
                Row(Modifier.fillMaxWidth().padding(11.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("● Salvo no celular", color = Color(0xFF166544))
                    Text("Pendentes: " + pending.size, color = Color(0xFF166544))
                }
            }
            if (pending.any { it.conflict.isNotBlank() }) {
                Text("⚠ Conflito de sincronização. Seus dados locais permanecem salvos.", color = Color(0xFFAA4A23))
            }
            if (current == null) {
                Text("Visão geral", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                SummaryCard(sum(null), readings.size)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("Pluviômetros", gauges.size.toString(), Modifier.weight(1f))
                    StatCard("Medições", readings.size.toString(), Modifier.weight(1f))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("Pluviômetros", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Button(onClick = { newGauge = true }, enabled = vm.canWrite()) { Text("+ Novo") }
                }
                if (gauges.isEmpty()) Text("Nenhum pluviômetro cadastrado.", color = gray)
                gauges.chunked(2).forEach { pair ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        pair.forEach { gauge ->
                            Card(
                                modifier = Modifier.weight(1f).height(150.dp),
                                colors = CardDefaults.cardColors(containerColor = Color.White),
                                onClick = { selected = gauge.id }
                            ) {
                                Column(Modifier.fillMaxSize().padding(13.dp), verticalArrangement = Arrangement.SpaceBetween) {
                                    Column {
                                        Text("💧")
                                        Text(gauge.name, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                        Text(gauge.location.ifBlank { "Sem localização" },
                                            color = gray, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                                    }
                                    Text(mmText(sum(gauge.id)) + " mm", fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                        if (pair.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            } else {
                TextButton(onClick = { selected = null }) { Text("← Voltar") }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(current.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(current.location.ifBlank { "Sem localização" }, color = gray)
                    }
                    TextButton(onClick = { editGauge = current }, enabled = vm.canWrite()) { Text("Editar") }
                }
                SummaryCard(sum(current.id), visible.size)
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(15.dp)) {
                        Text("Descrição", fontWeight = FontWeight.Bold)
                        Text(current.description.ifBlank { "Não informada" }, color = gray)
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("Histórico", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Button(onClick = { newReading = true }, enabled = vm.canWrite()) { Text("+ Registrar") }
                }
                if (visible.isEmpty()) Text("Nenhuma medição registrada.", color = gray)
                visible.forEach { reading ->
                    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White)) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(mmText(reading.amountMm) + " mm", fontWeight = FontWeight.Bold)
                                Text(dateText(reading.observedAt), color = gray, style = MaterialTheme.typography.labelSmall)
                                if (reading.notes.isNotBlank()) Text(reading.notes, color = gray)
                            }
                            TextButton(onClick = { editReading = reading }, enabled = vm.canWrite()) { Text("Editar") }
                            TextButton(onClick = { removeReading = reading }, enabled = vm.canWrite()) { Text("Excluir") }
                        }
                    }
                }
                OutlinedButton(onClick = { removeGauge = true }, enabled = vm.canWrite()) { Text("Excluir pluviômetro") }
            }
        }
    }

    if (newGauge || editGauge != null) {
        GaugeDialog(editGauge, { newGauge = false; editGauge = null }) { name, location, description ->
            vm.saveGauge(editGauge?.id, name, location, description)
            newGauge = false
            editGauge = null
        }
    }
    if (newReading || editReading != null) {
        ReadingDialog(editReading, { newReading = false; editReading = null }) { amount, timestamp, notes ->
            selected?.let { vm.saveReading(editReading?.id, it, amount, timestamp, notes) }
            newReading = false
            editReading = null
        }
    }
    if (settings) {
        ServerDialog(vm.savedServer(), username, pending.size, busy, { settings = false },
            { server, user, pass -> vm.login(server, user, pass) }, { vm.synchronize() })
    }
    if (removeGauge && selected != null) {
        AlertDialog(
            onDismissRequest = { removeGauge = false },
            title = { Text("Excluir pluviômetro?") },
            text = { Text("A exclusão será salva offline. As medições existentes serão preservadas no banco.") },
            confirmButton = { TextButton(onClick = {
                selected?.let(vm::deleteGauge)
                selected = null
                removeGauge = false
            }) { Text("Excluir") } },
            dismissButton = { TextButton(onClick = { removeGauge = false }) { Text("Cancelar") } }
        )
    }
    removeReading?.let { item ->
        AlertDialog(
            onDismissRequest = { removeReading = null },
            title = { Text("Excluir medição?") },
            confirmButton = { TextButton(onClick = {
                vm.deleteReading(item.id)
                removeReading = null
            }) { Text("Excluir") } },
            dismissButton = { TextButton(onClick = { removeReading = null }) { Text("Cancelar") } }
        )
    }
}

@Composable
private fun SummaryCard(value: Double, count: Int) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = deepBlue),
        shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(21.dp)) {
            Text("Chuva acumulada", color = Color(0xFFC5DFE7))
            Text(mmText(value) + " mm", style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold, color = Color.White)
            Text(count.toString() + " medições", color = Color(0xFFC5DFE7))
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier) {
    Card(modifier, colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Column(Modifier.padding(14.dp)) {
            Text(label, color = gray)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun GaugeDialog(current: Gauge?, close: () -> Unit, save: (String, String, String) -> Unit) {
    var name by remember(current?.id) { mutableStateOf(current?.name ?: "") }
    var location by remember(current?.id) { mutableStateOf(current?.location ?: "") }
    var description by remember(current?.id) { mutableStateOf(current?.description ?: "") }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(if (current == null) "Novo pluviômetro" else "Editar pluviômetro") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Nome") }, singleLine = true)
                OutlinedTextField(location, { location = it }, label = { Text("Localização") })
                OutlinedTextField(description, { description = it }, label = { Text("Descrição") }, minLines = 2)
            }
        },
        confirmButton = { TextButton(onClick = { save(name, location, description) },
            enabled = name.isNotBlank()) { Text("Salvar") } },
        dismissButton = { TextButton(onClick = close) { Text("Cancelar") } }
    )
}

@Composable
private fun ReadingDialog(current: Reading?, close: () -> Unit, save: (Double, String, String) -> Unit) {
    var amount by remember(current?.id) {
        mutableStateOf(if (current == null) "" else current.amountMm.toString())
    }
    var whenAt by remember(current?.id) {
        mutableStateOf(current?.observedAt?.let(::dateInput) ?: dateInput(null))
    }
    var notes by remember(current?.id) { mutableStateOf(current?.notes ?: "") }
    val number = amount.replace(",", ".").toDoubleOrNull()
    val validTime = runCatching { LocalDateTime.parse(whenAt) }.isSuccess
    AlertDialog(
        onDismissRequest = close,
        title = { Text(if (current == null) "Registrar chuva" else "Editar medição") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(amount, { amount = it }, label = { Text("Chuva (mm)") }, singleLine = true)
                OutlinedTextField(whenAt, { whenAt = it },
                    label = { Text("Data e hora (AAAA-MM-DDTHH:MM)") }, singleLine = true)
                OutlinedTextField(notes, { notes = it }, label = { Text("Observações") }, minLines = 2)
                Text("A medição será salva primeiro no celular.", style = MaterialTheme.typography.labelSmall, color = gray)
            }
        },
        confirmButton = { TextButton(
            onClick = {
                val local = LocalDateTime.parse(whenAt)
                save(number!!, local.atZone(ZoneId.systemDefault()).toOffsetDateTime().toString(), notes)
            },
            enabled = number != null && number.isFinite() && number in 0.0..10000.0 && validTime
        ) { Text("Salvar") } },
        dismissButton = { TextButton(onClick = close) { Text("Cancelar") } }
    )
}

@Composable
private fun ServerDialog(server: String, username: String, pending: Int, busy: Boolean,
    close: () -> Unit, connect: (String, String, String) -> Unit, sync: () -> Unit
) {
    var url by remember { mutableStateOf(server) }
    var user by remember { mutableStateOf(username) }
    var password by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = close,
        title = { Text("Servidor e sincronização") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Os registros funcionam offline e serão enviados à API quando houver rede.",
                    color = gray, style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(url, { url = it }, label = { Text("Endereço HTTPS da API") },
                    placeholder = { Text("https://api.exemplo.com") }, singleLine = true)
                OutlinedTextField(user, { user = it }, label = { Text("Usuário") }, singleLine = true)
                OutlinedTextField(password, { password = it }, label = { Text("Senha") },
                    visualTransformation = PasswordVisualTransformation(), singleLine = true)
                Text("Registros aguardando envio: " + pending)
                OutlinedButton(onClick = sync, enabled = !busy) { Text("Solicitar sincronização") }
            }
        },
        confirmButton = { TextButton(onClick = { connect(url, user, password) },
            enabled = !busy && url.startsWith("https://") && user.isNotBlank() && password.isNotBlank()) {
            Text("Conectar")
        } },
        dismissButton = { TextButton(onClick = close) { Text("Fechar") } }
    )
}

private fun mmText(value: Double): String =
    String.format(Locale.forLanguageTag("pt-BR"), "%,.2f", value)

private fun dateText(iso: String): String = try {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm"))
} catch (_: Exception) { iso }

private fun dateInput(iso: String?): String = try {
    val value = if (iso == null) LocalDateTime.now()
        else OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime()
    value.format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm"))
} catch (_: Exception) { LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")) }
