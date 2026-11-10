package com.samukis.papernotes.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/** Los muelles de la app. Lo que se mueve va con muelle; color y opacidad, con tween. */
object Motion {
    fun <T> estandar() = spring<T>(dampingRatio = 0.94f, stiffness = 380f)
    fun <T> rapido() = spring<T>(dampingRatio = 1f, stiffness = 900f)
    /** Para valores sin unidades (0→1): con el umbral por defecto el último 1 % salta. */
    fun suave(umbral: Float = 0.0005f) = spring(dampingRatio = 1f, stiffness = Spring.StiffnessMediumLow, visibilityThreshold = umbral)
}

/**
 * Lo pulsable: sin onda de Material, se apaga un poco mientras se pulsa (como
 * `:active` en la web). `alMantener` vibra y abre el menú de esa cosa.
 */
@OptIn(ExperimentalFoundationApi::class)
fun Modifier.toque(alMantener: (() -> Unit)? = null, activo: Boolean = true, escala: Boolean = false, alPulsar: () -> Unit): Modifier = composed {
    val fuente = remember { MutableInteractionSource() }
    val pulsado by fuente.collectIsPressedAsState()
    val t by animateFloatAsState(if (pulsado) 1f else 0f, if (pulsado) tween(60) else tween(180), label = "toque")
    val haptico = LocalHapticFeedback.current
    this.graphicsLayer {
        alpha = 1f - 0.35f * t
        if (escala) { val s = 1f - 0.015f * t; scaleX = s; scaleY = s }
    }.combinedClickable(
        interactionSource = fuente, indication = null, enabled = activo, onClick = alPulsar,
        onLongClick = alMantener?.let { f -> { haptico.performHapticFeedback(HapticFeedbackType.LongPress); f() } },
    )
}

@Composable
fun BotonIcono(iv: ImageVector, modifier: Modifier = Modifier, tint: Color = C.text, activo: Boolean = true, alPulsar: () -> Unit) {
    Box(modifier.size(44.dp).clip(CircleShape).toque(activo = activo, alPulsar = alPulsar), contentAlignment = Alignment.Center) {
        Icono(iv, tint = if (activo) tint else tint.copy(alpha = 0.3f))
    }
}

@Composable
fun Chip(texto: String, modifier: Modifier = Modifier, icono: ImageVector? = null, activo: Boolean = false, fondo: Color = C.surface, tinta: Color = C.text2, alPulsar: () -> Unit) {
    Row(
        modifier.height(32.dp).clip(RoundedCornerShape(50)).background(if (activo) C.text else fondo).toque(alPulsar = alPulsar).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icono != null) Icono(icono, size = 16.dp, tint = if (activo) C.surface else tinta)
        Texto(texto, size = 13.5.sp, color = if (activo) C.surface else tinta, maxLines = 1)
    }
}

@Composable
fun Seccion(texto: String, modifier: Modifier = Modifier) {
    Texto(texto, modifier.padding(start = 4.dp, top = 10.dp, bottom = 10.dp), size = 13.sp, color = C.section, weight = FontWeight.Medium, spacing = 0.2.sp)
}

/** Cabecera centrada de las pantallas secundarias: atrás · título · acción. */
@Composable
fun CabeceraCentrada(titulo: String, alVolver: () -> Unit, derecha: @Composable () -> Unit = {}) {
    Box(Modifier.fillMaxWidth().height(48.dp)) {
        BotonIcono(Ico.back, Modifier.align(Alignment.CenterStart), alPulsar = alVolver)
        Texto(titulo, Modifier.align(Alignment.Center), size = 17.sp, weight = FontWeight.Medium)
        Box(Modifier.align(Alignment.CenterEnd)) { derecha() }
    }
}

// ─────────────── hojas (menús y diálogos, desde abajo como en HyperOS) ───────────────

class ItemMenu(val etiqueta: String, val icono: ImageVector? = null, val peligro: Boolean = false, val marcado: Boolean = false, val alPulsar: () -> Unit)

/** La capa de la hoja: velo + tarjeta que sube. La pinta `Raiz` encima de todo. */
@Composable
fun CapaHoja(ui: Ui) {
    val contenido = ui.hoja
    /* Se recuerda la última para que la salida se anime con su contenido. */
    var ultima by remember { mutableStateOf<(@Composable () -> Unit)?>(null) }
    if (contenido != null) ultima = contenido
    val t = remember { Animatable(0f) }
    LaunchedEffect(contenido != null) {
        t.animateTo(if (contenido != null) 1f else 0f, Motion.suave())
        if (contenido == null) ultima = null
    }
    val pinta = ultima ?: return
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().graphicsLayer { alpha = t.value.coerceIn(0f, 1f) }.background(C.scrim).toque { ui.hoja = null })
        Column(
            Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime))
                .padding(12.dp).fillMaxWidth()
                .graphicsLayer { translationY = (1f - t.value) * size.height * 1.15f }
                .clip(RoundedCornerShape(26.dp)).background(C.surface).toque(alPulsar = {})
                .heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(8.dp),
        ) { pinta() }
    }
}

@Composable
fun MenuHoja(ui: Ui, titulo: String? = null, items: List<ItemMenu>) {
    if (titulo != null) Texto(titulo, Modifier.padding(start = 14.dp, top = 10.dp, bottom = 6.dp, end = 14.dp), size = 13.sp, color = C.muted, maxLines = 1)
    for (it in items) {
        Row(
            Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(16.dp)).toque { ui.hoja = null; it.alPulsar() }.padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val tinta = if (it.peligro) C.danger else C.text
            if (it.icono != null) { Icono(it.icono, tint = if (it.peligro) C.danger else C.text2, size = 22.dp); Spacer(Modifier.width(14.dp)) }
            Texto(it.etiqueta, Modifier.weight(1f), size = 16.sp, color = tinta, maxLines = 1)
            if (it.marcado) Icono(Ico.check, tint = C.accent, size = 22.dp)
        }
    }
}

fun Ui.menu(titulo: String? = null, items: List<ItemMenu>) { hoja = { MenuHoja(this, titulo, items) } }

@Composable
fun BotonTexto(texto: String, modifier: Modifier = Modifier, primario: Boolean = false, peligro: Boolean = false, alPulsar: () -> Unit) {
    Box(
        modifier.height(44.dp).clip(RoundedCornerShape(14.dp)).background(if (primario) C.accent else if (peligro) Color.Transparent else C.surface2).toque(alPulsar = alPulsar).padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center,
    ) { Texto(texto, size = 15.sp, weight = FontWeight.Medium, color = if (primario) C.accentInk else if (peligro) C.danger else C.text) }
}

fun Ui.confirmar(titulo: String, texto: String, si: String = "Sí", peligro: Boolean = false, alAceptar: () -> Unit) {
    hoja = {
        Column(Modifier.padding(14.dp)) {
            Texto(titulo, size = 19.sp, weight = FontWeight.Medium)
            Spacer(Modifier.height(8.dp))
            Texto(texto, size = 15.sp, color = C.text2, lineHeight = 21.sp)
            Spacer(Modifier.height(18.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                BotonTexto("Cancelar") { hoja = null }
                BotonTexto(si, primario = !peligro, peligro = peligro) { hoja = null; alAceptar() }
            }
        }
    }
}

/** Pide un nombre (carpeta nueva, renombrar). */
fun Ui.pedirTexto(titulo: String, inicial: String = "", alAceptar: (String) -> Unit) {
    hoja = {
        var v by remember { mutableStateOf(TextFieldValue(inicial, TextRange(0, inicial.length))) }
        val foco = remember { FocusRequester() }
        fun ok() { val t = v.text.trim(); if (t.isNotEmpty()) { hoja = null; alAceptar(t) } }
        Column(Modifier.padding(14.dp)) {
            Texto(titulo, size = 19.sp, weight = FontWeight.Medium)
            Spacer(Modifier.height(14.dp))
            Campo(v, { v = it }, "Nombre", Modifier.focusRequester(foco), alTerminar = ::ok)
            Spacer(Modifier.height(18.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                BotonTexto("Cancelar") { hoja = null }
                BotonTexto("Aceptar", primario = true, alPulsar = ::ok)
            }
        }
        LaunchedEffect(Unit) { delay(120); runCatching { foco.requestFocus() } }
    }
}

/** Un campo de una línea con el aspecto de los de la web (gris, radio 14). */
@Composable
fun Campo(
    valor: TextFieldValue, alCambiar: (TextFieldValue) -> Unit, pista: String, modifier: Modifier = Modifier,
    opciones: KeyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
    oculto: Boolean = false, alto: Dp = 48.dp, alTerminar: () -> Unit = {},
) {
    BasicTextField(
        valor, alCambiar, modifier.fillMaxWidth().height(alto).clip(RoundedCornerShape(14.dp)).background(C.surface2).padding(horizontal = 14.dp),
        textStyle = TextStyle(color = C.text, fontSize = 16.sp, fontFamily = Geist), singleLine = true, cursorBrush = SolidColor(C.accent),
        keyboardOptions = opciones, keyboardActions = KeyboardActions(onAny = { alTerminar() }),
        visualTransformation = if (oculto) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        decorationBox = { campo ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (valor.text.isEmpty()) Texto(pista, size = 16.sp, color = C.muted)
                campo()
            }
        },
    )
}

// ─────────────── avisos (el toast oscuro de la web, con «Deshacer») ───────────────

@Composable
fun CapaAviso(ui: Ui, modifier: Modifier = Modifier) {
    val a = ui.aviso
    var visto by remember { mutableStateOf<Aviso?>(null) }
    if (a != null) visto = a
    val t by animateFloatAsState(if (a != null) 1f else 0f, Motion.suave(), label = "aviso", finishedListener = { if (it == 0f) visto = null })
    LaunchedEffect(a?.id) { if (a != null) { delay(if (a.accion != null) 5000 else 2600); if (ui.aviso === a) ui.aviso = null } }
    val v = visto ?: return
    Row(
        modifier.padding(horizontal = 16.dp).fillMaxWidth().graphicsLayer { alpha = t.coerceIn(0f, 1f); translationY = (1f - t) * 24f }
            .clip(RoundedCornerShape(16.dp)).background(C.toast).padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Texto(v.texto, Modifier.weight(1f), size = 14.sp, color = Color.White)
        if (v.accion != null) Texto(v.accion, Modifier.padding(start = 14.dp).toque { ui.aviso = null; v.alPulsar?.invoke() }, size = 14.sp, color = C.accent, weight = FontWeight.SemiBold)
    }
}
