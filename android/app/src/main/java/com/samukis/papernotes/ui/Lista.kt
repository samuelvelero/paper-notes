package com.samukis.papernotes.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.lazy.staggeredgrid.rememberLazyStaggeredGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.samukis.papernotes.core.Derive
import com.samukis.papernotes.core.Fechas
import com.samukis.papernotes.data.Almacen
import com.samukis.papernotes.data.ErrorApi
import com.samukis.papernotes.data.Nota
import com.samukis.papernotes.data.rememberImagen
import kotlinx.coroutines.launch

/** El título de la lista según dónde se esté. */
fun tituloAmbito(alm: Almacen, ui: Ui) = when (ui.carpeta) {
    null -> "Notas"
    "" -> "Notas sueltas"
    else -> alm.datos.carpeta(ui.carpeta)?.name ?: "Notas"
}

@Composable
fun PantallaLista(alm: Almacen, ui: Ui) {
    val datos = alm.datos
    val q = ui.q
    val notas = remember(datos, ui.carpeta, ui.etiqueta, q, ui.orden) { datos.lista(ui.carpeta, ui.etiqueta, q, ui.orden) }
    val etiquetas = remember(datos, ui.carpeta) { datos.etiquetas(ui.carpeta) }
    val fijadas = remember(notas, q) { if (q.isBlank()) notas.filter { it.pinned } else emptyList() }
    val resto = remember(notas, q) { if (q.isBlank()) notas.filter { !it.pinned } else notas }
    val remotos = ui.remotos
    val estado = rememberLazyStaggeredGridState()
    val ambito = rememberCoroutineScope()
    val foco = LocalFocusManager.current
    val focoBusqueda = remember { FocusRequester() }
    LaunchedEffect(ui.enfocarBusqueda) {
        if (ui.enfocarBusqueda) { ui.enfocarBusqueda = false; estado.scrollToItem(0); runCatching { focoBusqueda.requestFocus() } }
    }
    fun buscarRemoto() {
        val texto = ui.q.trim()
        if (texto.isEmpty()) return
        foco.clearFocus()
        ambito.launch {
            try { ui.remotos = alm.api.buscar(texto, ui.carpeta, ui.etiqueta) }
            catch (e: ErrorApi) { ui.avisar("El buscador no respondió" + if (e.status == 0) " (sin conexión)" else "") }
        }
    }

    Box(Modifier.fillMaxSize().background(C.bg)) {
        LazyVerticalStaggeredGrid(
            columns = StaggeredGridCells.Fixed(if (ui.diseno == "grid") 2 else 1),
            state = estado,
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(start = M.gutter, end = M.gutter, bottom = 130.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalItemSpacing = 12.dp,
        ) {
            item(key = "cabecera", span = StaggeredGridItemSpan.FullLine, contentType = "cabecera") {
                Column {
                    Row(Modifier.fillMaxWidth().height(52.dp).padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (ui.carpeta != null) BotonIcono(Ico.back, Modifier.padding(start = 0.dp)) { ui.aLista(null) }
                        Spacer(Modifier.weight(1f))
                        BotonIcono(Ico.folder) { ui.ir(Pantalla.Carpetas) }
                        BotonIcono(Ico.settings) { ui.ir(Pantalla.Ajustes) }
                    }
                    Texto(tituloAmbito(alm, ui), Modifier.padding(top = 4.dp, bottom = 12.dp), size = 34.sp, lineHeight = 40.sp, spacing = (-0.3).sp, maxLines = 2)
                    Buscador(ui, focoBusqueda, ::buscarRemoto)
                    if (etiquetas.isNotEmpty()) LazyRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(etiquetas.take(30), key = { it.first }) { (nombre, _) ->
                            Chip("#$nombre", activo = ui.etiqueta == nombre) { ui.etiqueta = if (ui.etiqueta == nombre) null else nombre; ui.remotos = null }
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                }
            }
            if (remotos != null) {
                item(key = "h-remotos", span = StaggeredGridItemSpan.FullLine, contentType = "seccion") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Seccion("Resultados del buscador  ${remotos.size}", Modifier.weight(1f))
                        Chip("Quitar", icono = Ico.close) { ui.remotos = null }
                    }
                }
                val vivos = remotos.mapNotNull { (id, frag) -> datos.nota(id)?.takeIf { !it.enPapelera }?.let { it to frag } }
                if (vivos.isEmpty()) item(key = "vacio", span = StaggeredGridItemSpan.FullLine) { Vacio("Nada por ahí.") }
                items(vivos, key = { "r-" + it.first.id }, contentType = { "tarjeta" }) { (n, frag) -> Tarjeta(alm, ui, n, frag) }
            } else {
                if (notas.isEmpty()) item(key = "vacio", span = StaggeredGridItemSpan.FullLine) {
                    Vacio(if (q.isNotBlank()) "Nada con ese texto. Pulsa buscar en el teclado para buscar por significado." else "Sin notas todavía. Toca + para escribir la primera.")
                }
                if (fijadas.isNotEmpty()) {
                    item(key = "h-fijadas", span = StaggeredGridItemSpan.FullLine, contentType = "seccion") { Seccion("Fijadas") }
                    items(fijadas, key = { it.id }, contentType = { "tarjeta" }) { Tarjeta(alm, ui, it) }
                    if (resto.isNotEmpty()) item(key = "h-notas", span = StaggeredGridItemSpan.FullLine, contentType = "seccion") { Seccion("Notas") }
                }
                items(resto, key = { it.id }, contentType = { "tarjeta" }) { Tarjeta(alm, ui, it) }
            }
        }
        EstadoRed(alm, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 34.dp))
        Box(
            Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 22.dp, bottom = 24.dp).size(M.fab)
                .shadow(10.dp, CircleShape, ambientColor = C.accent, spotColor = C.accent).clip(CircleShape).background(C.accent)
                .toque(escala = true) { val n = alm.nuevaNota(ui.carpeta ?: ""); ui.abrirNota(n.id, nueva = true) },
            contentAlignment = Alignment.Center,
        ) { Icono(Ico.plus, tint = C.accentInk, size = 28.dp) }
    }
}

@Composable
private fun Buscador(ui: Ui, foco: FocusRequester, alBuscar: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(14.dp)).background(C.surface).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icono(Ico.search, tint = C.muted, size = 20.dp)
        Spacer(Modifier.width(8.dp))
        BasicTextField(
            ui.q, { ui.q = it; ui.remotos = null }, Modifier.weight(1f).focusRequester(foco),
            textStyle = TextStyle(color = C.text, fontSize = 15.sp, fontFamily = Geist), singleLine = true, cursorBrush = SolidColor(C.accent),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { alBuscar() }),
            decorationBox = { campo -> Box(contentAlignment = Alignment.CenterStart) { if (ui.q.isEmpty()) Texto("Buscar", size = 15.sp, color = C.muted); campo() } },
        )
        if (ui.q.isNotEmpty()) Icono(Ico.close, Modifier.toque { ui.q = ""; ui.remotos = null }, tint = C.muted, size = 20.dp)
    }
}

@Composable
fun Vacio(texto: String) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 60.dp), contentAlignment = Alignment.Center) {
        Texto(texto, size = 15.sp, color = C.muted, align = androidx.compose.ui.text.style.TextAlign.Center, lineHeight = 21.sp)
    }
}

/** Silencio = todo arriba. Solo habla si hay cambios sin subir y no hay red. */
@Composable
private fun EstadoRed(alm: Almacen, modifier: Modifier) {
    if (!(alm.sinRed && alm.pendientes > 0)) return
    val n = alm.pendientes
    Box(modifier.clip(RoundedCornerShape(50)).background(Color(0xFFC62828)).padding(horizontal = 14.dp, vertical = 7.dp)) {
        Texto("Sin conexión · $n ${if (n == 1) "cambio" else "cambios"} por subir", size = 13.sp, color = Color.White)
    }
}

@Composable
fun Tarjeta(alm: Almacen, ui: Ui, n: Nota, fragmento: String? = null) {
    val portada = remember(n.body) { Derive.cover(n.body) }
    val extracto = remember(n.plain, n.title, fragmento) { fragmento?.takeIf { it.isNotBlank() } ?: Derive.excerpt(n.title, n.plain) }
    val fecha = remember(n.updated) { Fechas.nice(n.updated) }
    val carpeta = if (ui.carpeta == null && n.folder.isNotEmpty()) alm.datos.carpeta(n.folder)?.name else null
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(M.radioTarjeta)).background(C.surface)
            .toque(alMantener = { ui.menu(n.title.ifEmpty { "Sin título" }, menuNota(alm, ui, n.id, conAbrir = true)) }, escala = true) { ui.abrirNota(n.id) },
    ) {
        if (portada != null) {
            val img by rememberImagen(alm.urlAdjunto(portada), 720)
            val b = img
            if (b != null) Image(b, null, Modifier.fillMaxWidth().heightIn(max = 260.dp).aspectRatio(b.width.toFloat() / b.height.coerceAtLeast(1), matchHeightConstraintsFirst = false), contentScale = ContentScale.Crop)
            else Box(Modifier.fillMaxWidth().height(120.dp).background(C.surface2))
        }
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp)) {
            if (n.title.isNotEmpty()) Texto(n.title, size = 19.sp, weight = FontWeight.Medium, maxLines = 1, lineHeight = 24.sp)
            else Texto("Sin título", size = 19.sp, weight = FontWeight.Medium, color = C.muted, maxLines = 1, lineHeight = 24.sp)
            Texto(extracto.ifEmpty { "Sin texto" }, Modifier.padding(top = 6.dp), size = 14.sp, color = if (extracto.isEmpty()) C.muted else C.text2, maxLines = 4, lineHeight = 19.5.sp)
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (n.pinned) Icono(Ico.pin, tint = C.accent, size = 14.dp)
                if (n.share.isNotEmpty()) Icono(Ico.link, tint = C.muted, size = 14.dp)
                Texto(fecha + (carpeta?.let { " · $it" } ?: ""), size = 12.5.sp, color = C.muted, maxLines = 1)
            }
        }
    }
}

// ─────────────── las acciones de una nota (menú de la tarjeta y del ⋮) ───────────────

fun menuNota(alm: Almacen, ui: Ui, id: String, conAbrir: Boolean = false, ctx: Context? = null): List<ItemMenu> {
    val n = alm.datos.nota(id) ?: return emptyList()
    val items = ArrayList<ItemMenu>()
    if (conAbrir) items += ItemMenu("Abrir", Ico.open) { ui.abrirNota(id) }
    items += ItemMenu(if (n.pinned) "Desfijar" else "Fijar", if (n.pinned) Ico.pinOff else Ico.pin) {
        alm.cambiarNota(id) { it.copy(pinned = !it.pinned) }
        ui.avisar(if (n.pinned) "Nota desfijada" else "Nota fijada")
    }
    items += ItemMenu("Mover a…", Ico.move) { ui.hoja = { HojaMover(alm, ui, id) } }
    items += ItemMenu(if (n.share.isEmpty()) "Compartir enlace público" else "Enlace público…", Ico.link) { ui.hoja = { HojaCompartir(alm, ui, id) } }
    items += ItemMenu("Mover a la papelera", Ico.trash, peligro = true) { aPapelera(alm, ui, id) }
    return items
}

fun aPapelera(alm: Almacen, ui: Ui, id: String) {
    val antes = alm.datos.nota(id) ?: return
    alm.aPapelera(id)
    if ((ui.actual as? Pantalla.Nota)?.id == id) ui.atras()
    ui.avisar("Nota en la papelera", "Deshacer") { alm.cambiarNota(id) { it.copy(trashedAt = "", pinned = antes.pinned) } }
}

@Composable
fun HojaMover(alm: Almacen, ui: Ui, id: String) {
    val n = alm.datos.nota(id) ?: return
    val filas = remember(alm.datos.carpetas) {
        val out = ArrayList<Triple<String, String, Int>>()
        out += Triple("", "Notas", 0)
        fun rec(parent: String, prof: Int) { for (c in alm.datos.hijas(parent)) { out += Triple(c.id, c.name, prof); rec(c.id, prof + 1) } }
        rec("", 0)
        out
    }
    Texto("Mover a", Modifier.padding(start = 14.dp, top = 12.dp, bottom = 8.dp), size = 19.sp, weight = FontWeight.Medium)
    for ((cid, nombre, prof) in filas) {
        val aqui = n.folder == cid
        Row(
            Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(14.dp)).background(if (aqui) C.accentSoft else Color.Transparent)
                .toque {
                    ui.hoja = null
                    if (!aqui) { val antes = n.folder; alm.mover(id, cid); ui.avisar("Movida a «$nombre»", "Deshacer") { alm.mover(id, antes) } }
                }.padding(start = (14 + prof * 18).dp, end = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icono(Ico.folder, tint = C.text2, size = 22.dp)
            Spacer(Modifier.width(12.dp))
            Texto(nombre, Modifier.weight(1f), size = 16.sp, maxLines = 1)
            if (aqui) Icono(Ico.check, tint = C.accent, size = 22.dp)
        }
    }
    Row(
        Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(14.dp)).toque {
            ui.pedirTexto("Nueva carpeta") { nombre -> val c = alm.nuevaCarpeta(nombre); alm.mover(id, c.id); ui.avisar("Movida a «${c.name}»") }
        }.padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icono(Ico.plus, tint = C.text2, size = 22.dp)
        Spacer(Modifier.width(12.dp))
        Texto("Nueva carpeta", size = 16.sp, color = C.text2)
    }
}

/** El enlace público de solo lectura (`notes.share`): crearlo, copiarlo, enviarlo, quitarlo. */
@Composable
fun HojaCompartir(alm: Almacen, ui: Ui, id: String) {
    val ctx = LocalContext.current
    val n = alm.datos.nota(id) ?: return
    LaunchedEffect(id) { if (n.share.isEmpty()) alm.cambiarNota(id) { it.copy(share = Almacen.tokenCompartir()) } }
    val url = (alm.sesion?.base ?: "") + "/shared/" + n.share
    Column(Modifier.padding(14.dp)) {
        Texto("Enlace público", size = 19.sp, weight = FontWeight.Medium)
        Spacer(Modifier.height(8.dp))
        Texto("Cualquiera con el enlace puede leer esta nota, sin cuenta. No puede editarla ni ver tus otras notas.", size = 15.sp, color = C.text2, lineHeight = 21.sp)
        Spacer(Modifier.height(14.dp))
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.surface2).padding(horizontal = 14.dp, vertical = 13.dp)) {
            Texto(if (n.share.isEmpty()) "Creando…" else url, size = 14.sp, color = C.text2, maxLines = 2)
        }
        if (alm.sinRed) Texto("Sin conexión: el enlace funcionará cuando se suba el cambio.", Modifier.padding(top = 10.dp), size = 13.sp, color = C.muted)
        Spacer(Modifier.height(18.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Texto("Dejar de compartir", Modifier.toque {
                val antes = n.share
                alm.cambiarNota(id) { it.copy(share = "") }
                ui.hoja = null
                ui.avisar("El enlace dejó de funcionar", "Deshacer") { alm.cambiarNota(id) { it.copy(share = antes) } }
            }.padding(vertical = 10.dp), size = 15.sp, color = C.danger, weight = FontWeight.Medium)
            Spacer(Modifier.weight(1f))
            BotonTexto("Enviar…") {
                ui.hoja = null
                ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url).putExtra(Intent.EXTRA_SUBJECT, n.title), null))
            }
            BotonTexto("Copiar", primario = true) {
                ctx.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Enlace", url))
                ui.hoja = null
                ui.avisar("Enlace copiado")
            }
        }
    }
}

/** Manda el texto de la nota a otra app (el «compartir» de siempre). */
fun enviarTexto(ctx: Context, n: Nota) {
    ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, n.plain).putExtra(Intent.EXTRA_SUBJECT, n.title), null))
}
