package com.samukis.papernotes.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.samukis.papernotes.R

/* El sistema visual es el de la web (pb_public/styles.css → Notas de HyperOS):
   fondo gris muy claro, superficies blancas de radio grande y SIN sombra, un
   solo acento ámbar, jerarquía por tamaño y no por peso, iconos de trazo
   fino. Aquí no hay Material: todo se dibuja con `foundation` y estos tokens. */

@Immutable
class Colores(
    val bg: Color, val surface: Color, val surface2: Color, val text: Color, val text2: Color, val muted: Color,
    val section: Color, val accent: Color, val accentInk: Color, val accentSoft: Color, val danger: Color,
    val hair: Color, val hair2: Color, val link: Color, val tagInk: Color, val scrim: Color, val toast: Color, val oscuro: Boolean,
)

val Claros = Colores(
    bg = Color(0xFFF5F5F7), surface = Color(0xFFFFFFFF), surface2 = Color(0xFFEFEFF2), text = Color(0xFF111113), text2 = Color(0xFF5C5C62),
    muted = Color(0xFF8A8A8E), section = Color(0xFF8C8FA8), accent = Color(0xFFFFB300), accentInk = Color(0xFF1A1200), accentSoft = Color(0xFFFFF3D1),
    danger = Color(0xFFD7342B), hair = Color(0x12000000), hair2 = Color(0x1F000000), link = Color(0xFF1A73E8), tagInk = Color(0xFFC98700),
    scrim = Color(0x40000000), toast = Color(0xFF222226), oscuro = false,
)
val Oscuros = Colores(
    bg = Color(0xFF121214), surface = Color(0xFF1E1E21), surface2 = Color(0xFF2A2A2E), text = Color(0xFFF2F2F4), text2 = Color(0xFFB5B5BB),
    muted = Color(0xFF8A8A90), section = Color(0xFF9A9DB5), accent = Color(0xFFFFB300), accentInk = Color(0xFF1A1200), accentSoft = Color(0xFF3A2E10),
    danger = Color(0xFFFF6B60), hair = Color(0x14FFFFFF), hair2 = Color(0x24FFFFFF), link = Color(0xFF6EA8FF), tagInk = Color(0xFFFFC94D),
    scrim = Color(0x80000000), toast = Color(0xFF2E2E33), oscuro = true,
)

val LocalColores = staticCompositionLocalOf { Claros }
val C: Colores @Composable @ReadOnlyComposable get() = LocalColores.current

val Geist = FontFamily(
    Font(R.font.geist_regular, FontWeight.Normal), Font(R.font.geist_medium, FontWeight.Medium),
    Font(R.font.geist_semibold, FontWeight.SemiBold), Font(R.font.geist_bold, FontWeight.Bold),
)
val Mono = FontFamily.Monospace

/** Medidas compartidas (los px de la web son dp). */
object M {
    val gutter = 20.dp
    val radioTarjeta = 22.dp
    val radioImagen = 24.dp
    val fab = 64.dp
}

@Composable
fun PaperTheme(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalColores provides if (isSystemInDarkTheme()) Oscuros else Claros, content = content)
}

/** El texto de la app: Geist y los colores del tema. (foundation no tiene estilo ambiente.) */
@Composable
fun Texto(
    text: String, modifier: Modifier = Modifier, size: TextUnit = 15.sp, color: Color = C.text, weight: FontWeight = FontWeight.Normal,
    maxLines: Int = Int.MAX_VALUE, lineHeight: TextUnit = TextUnit.Unspecified, align: TextAlign? = null, spacing: TextUnit = TextUnit.Unspecified,
) {
    BasicText(
        text, modifier,
        style = TextStyle(color = color, fontSize = size, fontWeight = weight, fontFamily = Geist, lineHeight = lineHeight,
            textAlign = align ?: TextAlign.Unspecified, letterSpacing = spacing),
        maxLines = maxLines, overflow = TextOverflow.Ellipsis,
    )
}

// ─────────────── iconos (los genera android/scripts/iconos-web.js) ───────────────

class IconoB {
    val b = ImageVector.Builder(defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
    private fun nodos(d: String) = PathParser().parsePathString(d).toNodes()
    fun p(d: String, w: Float = 1.7f, alfa: Float = 1f) {
        b.addPath(nodos(d), stroke = SolidColor(Color.Black), strokeLineWidth = w, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round, strokeAlpha = alfa)
    }
    fun c(cx: Float, cy: Float, r: Float, relleno: Boolean = false, w: Float = 1.7f, alfa: Float = 1f) {
        val d = "M${cx - r},${cy}a$r,$r 0 1,0 ${2 * r},0a$r,$r 0 1,0 ${-2 * r},0z"
        if (relleno) b.addPath(nodos(d), fill = SolidColor(Color.Black)) else p(d, w, alfa)
    }
    fun r(x: Float, y: Float, w: Float, h: Float, rx: Float, wTrazo: Float = 1.7f, alfa: Float = 1f) {
        p("M${x + rx},${y}h${w - 2 * rx}a$rx,$rx 0 0 1 $rx,${rx}v${h - 2 * rx}a$rx,$rx 0 0 1 ${-rx},${rx}h${-(w - 2 * rx)}a$rx,$rx 0 0 1 ${-rx},${-rx}v${-(h - 2 * rx)}a$rx,$rx 0 0 1 $rx,${-rx}z", wTrazo, alfa)
    }
}
fun icono(f: IconoB.() -> Unit): ImageVector = IconoB().apply(f).b.build()

@Composable
fun Icono(iv: ImageVector, modifier: Modifier = Modifier, tint: Color = C.text, size: Dp = 24.dp) {
    Image(rememberVectorPainter(iv), null, modifier.size(size), colorFilter = ColorFilter.tint(tint))
}
