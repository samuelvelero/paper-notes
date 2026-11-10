package com.samukis.papernotes.ui.editor

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.samukis.papernotes.core.Inline
import com.samukis.papernotes.core.Kind
import com.samukis.papernotes.core.Mark
import com.samukis.papernotes.core.isHeading
import com.samukis.papernotes.core.isList
import com.samukis.papernotes.data.Almacen
import com.samukis.papernotes.data.rememberImagen
import com.samukis.papernotes.ui.C
import com.samukis.papernotes.ui.Colores
import com.samukis.papernotes.ui.Geist
import com.samukis.papernotes.ui.Ico
import com.samukis.papernotes.ui.Icono
import com.samukis.papernotes.ui.ItemMenu
import com.samukis.papernotes.ui.M
import com.samukis.papernotes.ui.Mono
import com.samukis.papernotes.ui.Texto
import com.samukis.papernotes.ui.Ui
import com.samukis.papernotes.ui.menu
import com.samukis.papernotes.ui.toque

/**
 * El formato inline, pintado sobre el texto tal cual. En el bloque con el
 * cursor las marcas (`**`, `\`, `](url)`) se ven apagadas; en los demás se
 * esconden, con un mapa de posiciones para que tocar una palabra ponga el
 * cursor en ella y no dos letras más allá.
 */
class EstiloInline(private val oculto: Boolean, private val c: Colores) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val t = text.text
        if (t.isEmpty()) return TransformedText(text, OffsetMapping.Identity)
        val p = Inline.parse(t)
        if (p.spans.isEmpty() && p.markers.isEmpty()) return TransformedText(text, OffsetMapping.Identity)
        fun estilo(m: Mark) = when (m) {
            Mark.STRONG -> SpanStyle(fontWeight = FontWeight.Bold)
            Mark.EM -> SpanStyle(fontStyle = FontStyle.Italic)
            Mark.UNDERLINE -> SpanStyle(textDecoration = TextDecoration.Underline)
            Mark.STRIKE -> SpanStyle(textDecoration = TextDecoration.LineThrough, color = c.muted)
            Mark.CODE -> SpanStyle(fontFamily = Mono, background = c.surface2, fontSize = 0.92.em)
            Mark.LINK, Mark.WIKILINK -> SpanStyle(color = c.link)
            Mark.TAG -> SpanStyle(color = c.tagInk, background = c.accentSoft)
        }
        if (!oculto) {
            val b = AnnotatedString.Builder(t)
            for (s in p.spans) b.addStyle(estilo(s.mark), s.start, s.end)
            val apagado = SpanStyle(color = c.muted.copy(alpha = 0.55f), fontWeight = FontWeight.Normal, fontStyle = FontStyle.Normal, textDecoration = TextDecoration.None)
            for (r in p.markers) b.addStyle(apagado, r.first, r.last + 1)
            return TransformedText(b.toAnnotatedString(), OffsetMapping.Identity)
        }
        val n = t.length
        val fuera = BooleanArray(n)
        for (r in p.markers) for (i in r) if (i < n) fuera[i] = true
        val aVista = IntArray(n + 1)
        val aTexto = IntArray(n + 1)
        val sb = StringBuilder(n)
        for (i in 0 until n) {
            aVista[i] = sb.length
            if (!fuera[i]) { aTexto[sb.length] = i; sb.append(t[i]) }
        }
        aVista[n] = sb.length
        aTexto[sb.length] = n
        val largo = sb.length
        val b = AnnotatedString.Builder(sb.toString())
        for (s in p.spans) { val a = aVista[s.start]; val z = aVista[s.end]; if (z > a) b.addStyle(estilo(s.mark), a, z) }
        return TransformedText(b.toAnnotatedString(), object : OffsetMapping {
            override fun originalToTransformed(offset: Int) = aVista[offset.coerceIn(0, n)]
            override fun transformedToOriginal(offset: Int) = aTexto[offset.coerceIn(0, largo)]
        })
    }
    override fun equals(other: Any?) = other is EstiloInline && other.oculto == oculto && other.c === c
    override fun hashCode() = oculto.hashCode() * 31 + c.hashCode()
}
private val Double.em get() = androidx.compose.ui.unit.TextUnit(this.toFloat(), androidx.compose.ui.unit.TextUnitType.Em)

/** El estilo de texto de cada tipo de bloque. Los títulos son proporcionales
 *  al tamaño del editor, como en la web (1,88 · 1,41 · 1,12). */
fun estiloDe(kind: Kind, tam: Float, c: Colores, hecho: Boolean): TextStyle = when (kind) {
    Kind.H1 -> TextStyle(fontSize = (tam * 1.88f).sp, lineHeight = (tam * 1.88f * 1.22f).sp, fontWeight = FontWeight.Medium, letterSpacing = (-0.3).sp, color = c.text, fontFamily = Geist)
    Kind.H2 -> TextStyle(fontSize = (tam * 1.41f).sp, lineHeight = (tam * 1.41f * 1.22f).sp, fontWeight = FontWeight.Medium, color = c.text, fontFamily = Geist)
    Kind.H3 -> TextStyle(fontSize = (tam * 1.12f).sp, lineHeight = (tam * 1.12f * 1.25f).sp, fontWeight = FontWeight.SemiBold, color = c.text, fontFamily = Geist)
    Kind.CODE -> TextStyle(fontSize = (tam * 0.88f).sp, lineHeight = (tam * 0.88f * 1.5f).sp, color = c.text, fontFamily = Mono)
    Kind.QUOTE -> TextStyle(fontSize = tam.sp, lineHeight = (tam * 1.5f).sp, color = c.text2, fontFamily = Geist)
    else -> TextStyle(
        fontSize = tam.sp, lineHeight = (tam * 1.5f).sp, fontFamily = Geist,
        color = if (hecho) c.muted else c.text, textDecoration = if (hecho) TextDecoration.LineThrough else null,
    )
}

@Composable
fun BloqueVista(ed: Editor, b: Bloque, primero: Boolean, tam: Float, alm: Almacen, ui: Ui, soloLectura: Boolean) {
    val c = C
    val kind = b.kind
    /* El aire de arriba: proporcional al título (0,85 em), mínimo entre párrafos. */
    val arriba = when {
        primero -> 0.dp
        kind == Kind.H1 -> (tam * 1.88f * 0.75f).dp
        kind == Kind.H2 -> (tam * 1.41f * 0.8f).dp
        kind == Kind.H3 -> (tam * 1.12f * 0.85f).dp
        kind.isList -> 3.dp
        else -> 7.dp
    }
    val sangria = (b.depth * 22).dp
    when (kind) {
        Kind.HR -> {
            Box(Modifier.fillMaxWidth().padding(top = arriba).toque(alMantener = { ui.menu(null, listOf(ItemMenu("Quitar separador", Ico.trash, peligro = true) { ed.quitar(b) })) }) {}.padding(vertical = 14.dp)) {
                Box(Modifier.fillMaxWidth().height(1.5.dp).background(c.hair2))
            }
            return
        }
        Kind.IMAGE -> { BloqueImagen(ed, b, alm, ui, Modifier.padding(start = sangria, top = arriba + 4.dp, bottom = 6.dp)); return }
        else -> {}
    }
    val enfocado = ed.enfocado == b.id
    val estilo = remember(kind, tam, c, b.checked) { estiloDe(kind, tam, c, kind == Kind.TODO && b.checked) }
    val vista = remember(enfocado, c, kind) { if (kind == Kind.CODE) VisualTransformation.None else EstiloInline(oculto = !enfocado, c) }
    LaunchedEffect(ed.focoPendiente) {
        val f = ed.focoPendiente
        if (f != null && f.first == b.id) {
            b.valor = b.valor.copy(selection = TextRange(f.second.coerceIn(0, b.texto.length)))
            runCatching { b.foco.requestFocus() }
            ed.focoPendiente = null
        }
    }
    val mod = when (kind) {
        Kind.CODE -> Modifier.clip(RoundedCornerShape(14.dp)).background(c.surface2).padding(horizontal = 14.dp, vertical = 12.dp)
        Kind.QUOTE -> Modifier.drawBehind { drawRoundRect(c.accent, Offset(0f, 2.dp.toPx()), Size(3.dp.toPx(), size.height - 4.dp.toPx()), CornerRadius(2.dp.toPx())) }.padding(start = 16.dp, top = 2.dp, bottom = 2.dp)
        else -> Modifier
    }
    Row(Modifier.fillMaxWidth().padding(start = sangria, top = arriba)) {
        /* El margen de las listas: viñeta, número o casilla, a la altura de la primera línea. */
        val altoLinea = (tam * 1.5f).dp
        when (kind) {
            Kind.BULLET -> Box(Modifier.width(24.dp).height(altoLinea), contentAlignment = Alignment.Center) {
                Box(Modifier.size(5.5.dp).clip(RoundedCornerShape(50)).background(c.text))
            }
            Kind.ORDERED -> Box(Modifier.widthIn(min = 24.dp).height(altoLinea).padding(end = 6.dp), contentAlignment = Alignment.CenterEnd) {
                Texto("${ed.numeros[b.id] ?: b.start}.", size = tam.sp, color = c.text2)
            }
            Kind.TODO -> Box(Modifier.width(32.dp).height(altoLinea).toque(activo = !soloLectura) { ed.casilla(b) }, contentAlignment = Alignment.CenterStart) {
                Box(
                    Modifier.size(22.dp).clip(RoundedCornerShape(7.dp)).then(if (b.checked) Modifier.background(c.accent) else Modifier.border(1.7.dp, c.hair2, RoundedCornerShape(7.dp))),
                    contentAlignment = Alignment.Center,
                ) { if (b.checked) Icono(Ico.check, tint = c.accentInk, size = 16.dp) }
            }
            else -> {}
        }
        BasicTextField(
            value = b.valor,
            onValueChange = { ed.alCambiar(b, it) },
            modifier = Modifier.weight(1f).then(mod).focusRequester(b.foco)
                .onFocusChanged { if (it.isFocused) ed.enfocado = b.id else if (ed.enfocado == b.id) ed.enfocado = null }
                /* Retroceso al principio: el teclado manda la tecla cuando no hay
                   nada que borrar antes del cursor. */
                .onPreviewKeyEvent { e ->
                    e.type == KeyEventType.KeyDown && e.key == Key.Backspace && b.valor.selection.collapsed && b.valor.selection.start == 0 && ed.retroceso(b)
                },
            readOnly = soloLectura,
            textStyle = estilo,
            cursorBrush = SolidColor(c.accent),
            keyboardOptions = if (kind == Kind.CODE) KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false)
            else KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            visualTransformation = vista,
            decorationBox = { campo ->
                Box {
                    if (b.texto.isEmpty()) {
                        val pista = when {
                            kind == Kind.H1 && primero -> "Título"
                            kind == Kind.PARAGRAPH && ed.bloques.size == 1 -> "Escribe algo…"
                            kind.isHeading && enfocado -> "Encabezado"
                            kind == Kind.TODO && enfocado -> "Por hacer"
                            else -> null
                        }
                        if (pista != null) androidx.compose.foundation.text.BasicText(pista, style = estilo.copy(color = c.muted.copy(alpha = 0.7f), textDecoration = null))
                    }
                    campo()
                }
            },
        )
    }
}

@Composable
private fun BloqueImagen(ed: Editor, b: Bloque, alm: Almacen, ui: Ui, modifier: Modifier) {
    val id = remember(b.src) { Regex("^attachments/([a-z0-9]{15})$").find(b.src)?.groupValues?.get(1) }
    /* la URL depende de que el adjunto ya esté en `datos` (acaba de subir o de sincronizar) */
    val url = if (id != null) alm.urlAdjunto(id, "800x0") else b.src.takeIf { it.startsWith("http") }
    val img by rememberImagen(url, 1440)
    val bm = img
    val quitar = { ui.menu(null, listOf(ItemMenu("Quitar imagen", Ico.trash, peligro = true) { ed.quitar(b) })) }
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(M.radioImagen)).toque(alMantener = quitar, alPulsar = quitar)) {
        if (bm != null) Image(bm, b.alt, Modifier.fillMaxWidth().aspectRatio(bm.width.toFloat() / bm.height.coerceAtLeast(1)), contentScale = ContentScale.FillWidth)
        else Box(Modifier.fillMaxWidth().height(160.dp).background(C.surface2), contentAlignment = Alignment.Center) { Icono(Ico.image, tint = Color(0x558A8A8E), size = 32.dp) }
    }
}
