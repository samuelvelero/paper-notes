package com.samukis.papernotes

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import com.samukis.papernotes.ui.BotonIcono
import com.samukis.papernotes.ui.BotonTexto
import com.samukis.papernotes.ui.C
import com.samukis.papernotes.ui.Geist
import com.samukis.papernotes.ui.Ico
import com.samukis.papernotes.ui.Motion
import com.samukis.papernotes.ui.PaperTheme
import com.samukis.papernotes.ui.Texto
import com.samukis.papernotes.ui.toque
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * El cuadro flotante de «nota rápida»: se abre ENCIMA de lo que haya (el
 * tile de ajustes rápidos, «Compartir a Paper Notes», el widget), se escribe,
 * se guarda y desaparece, sin abrir la app. Lo compartido llega ya escrito.
 * Tocar fuera guarda lo escrito: aquí nunca se pierde texto por error; para
 * tirarlo está la X.
 */
class CapturaRapida : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val inicial = textoDe(intent)
        setContent {
            PaperTheme {
                var v by remember { mutableStateOf(TextFieldValue(inicial, TextRange(inicial.length))) }
                val foco = remember { FocusRequester() }
                val t = remember { Animatable(0f) }
                LaunchedEffect(Unit) { launch { t.animateTo(1f, Motion.suave()) }; delay(150); runCatching { foco.requestFocus() } }
                Box(Modifier.fillMaxSize().graphicsLayer { alpha = t.value.coerceIn(0f, 1f) }.background(C.scrim).toque { guardar(v.text, abrir = false) }) {
                    Column(
                        Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime)).padding(12.dp).fillMaxWidth()
                            .graphicsLayer { translationY = (1f - t.value) * 120.dp.toPx() }
                            .clip(RoundedCornerShape(26.dp)).background(C.surface).toque {}.padding(start = 20.dp, end = 12.dp, top = 8.dp, bottom = 14.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Texto("Nota rápida", Modifier.weight(1f), size = 13.sp, color = C.section, weight = FontWeight.Medium)
                            BotonIcono(Ico.close, tint = C.muted) { finish() }
                        }
                        BasicTextField(
                            v, { v = it },
                            Modifier.fillMaxWidth().padding(end = 8.dp).heightIn(min = 84.dp, max = 260.dp).verticalScroll(rememberScrollState()).focusRequester(foco),
                            textStyle = TextStyle(color = C.text, fontSize = 17.sp, lineHeight = 25.sp, fontFamily = Geist), cursorBrush = SolidColor(C.accent),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                            decorationBox = { campo -> Box { if (v.text.isEmpty()) Texto("Escribe algo…", size = 17.sp, color = C.muted); campo() } },
                        )
                        Spacer(Modifier.padding(top = 12.dp))
                        Row(Modifier.fillMaxWidth().padding(end = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                            BotonTexto("Abrir en la app") { guardar(v.text, abrir = true) }
                            BotonTexto("Guardar", primario = true) { guardar(v.text, abrir = false) }
                        }
                    }
                }
            }
        }
    }

    /** «Compartir» desde otra app: el asunto pasa a ser el título. */
    private fun textoDe(i: Intent?): String {
        if (i?.action != Intent.ACTION_SEND) return ""
        val texto = i.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
        val asunto = i.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
        return if (asunto.isNotEmpty() && asunto != texto && !texto.startsWith(asunto)) "# $asunto\n\n$texto" else texto
    }

    private var guardando = false
    private fun guardar(texto: String, abrir: Boolean) {
        if (guardando) return
        guardando = true
        lifecycleScope.launch {
            val alm = app.alm
            alm.cargado.await()
            if (!alm.haySesion) {
                Toast.makeText(this@CapturaRapida, "Entra primero en Paper Notes", Toast.LENGTH_LONG).show()
                startActivity(Intent(this@CapturaRapida, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } else if (texto.isNotBlank() || abrir) {
                val n = alm.nuevaNota("", texto.trim().ifEmpty { null })
                if (abrir) startActivity(Intent(this@CapturaRapida, MainActivity::class.java).setAction(MainActivity.ACCION_NOTA).putExtra("id", n.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                else { Toast.makeText(this@CapturaRapida, "Nota guardada", Toast.LENGTH_SHORT).show(); Refresco.subirPronto(this@CapturaRapida) }
            }
            finish()
        }
    }

    override fun finish() { super.finish(); @Suppress("DEPRECATION") overridePendingTransition(0, 0) }
}

// ─────────────── ajustes rápidos (el panel que baja desde arriba) ───────────────

private fun TileService.abrir(i: Intent) {
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    else @Suppress("DEPRECATION", "StartActivityAndCollapseDeprecated") startActivityAndCollapse(i)
}
private fun TileService.inactivo() { qsTile?.apply { state = Tile.STATE_INACTIVE; updateTile() } }

/** «Nota nueva»: abre el cuadro flotante sobre lo que haya en pantalla. */
class TileNota : TileService() {
    override fun onStartListening() = inactivo()
    override fun onClick() = abrir(Intent(this, CapturaRapida::class.java))
}

/** «Buscar notas»: abre la app con el cursor en el buscador. */
class TileBuscar : TileService() {
    override fun onStartListening() = inactivo()
    override fun onClick() = abrir(Intent(this, MainActivity::class.java).setAction(MainActivity.ACCION_BUSCAR))
}
