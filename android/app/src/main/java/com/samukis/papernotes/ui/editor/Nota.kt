package com.samukis.papernotes.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.samukis.papernotes.core.Derive
import com.samukis.papernotes.core.Fechas
import com.samukis.papernotes.core.Inline
import com.samukis.papernotes.core.Kind
import com.samukis.papernotes.core.Mark
import com.samukis.papernotes.data.Almacen
import com.samukis.papernotes.data.ErrorApi
import com.samukis.papernotes.ui.editor.BloqueVista
import com.samukis.papernotes.ui.editor.Editor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Una nota abierta. Lee como una página (sin barra, el texto ya con formato)
 * y se escribe tocando: no hay «modo edición». Se guarda sola: 800 ms después
 * de la última tecla, al salir y al esconderse la app.
 */
@Composable
fun PantallaNota(alm: Almacen, ui: Ui, id: String, nueva: Boolean) {
    val nota = alm.datos.nota(id)
    if (nota == null) {
        Column(Modifier.fillMaxSize().background(C.surface).statusBarsPadding().padding(horizontal = 12.dp)) {
            BotonIcono(Ico.back) { ui.atras() }
            Vacio("Esa nota ya no está.")
        }
        return
    }
    val ctx = LocalContext.current
    val ambito = rememberCoroutineScope()
    val foco = LocalFocusManager.current
    val ed = remember(id) { Editor(nota.body) }
    var guardado by remember(id) { mutableStateOf(nota.body) }
    val soloLectura = nota.enPapelera
    fun guardar() {
        val md = ed.markdown()
        if (md != guardado) { guardado = md; alm.guardarCuerpo(id, md) }
    }
    LaunchedEffect(ed.cambios) { if (ed.cambios > 0) { delay(800); guardar() } }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { guardar() }
    /* Llegó de otro dispositivo mientras está abierta: si aquí no hay nada sin
       guardar, se enseña; si lo hay, manda lo que se está escribiendo. */
    LaunchedEffect(nota.body) {
        if (nota.body != guardado && ed.markdown() == guardado) { ed.cargar(nota.body); guardado = nota.body }
    }
    val alSalir by rememberUpdatedState {
        guardar()
        /* una nota nueva que se quedó vacía no se guarda (como en Apple Notes) */
        val n = alm.datos.nota(id)
        if (nueva && n != null && Derive.isEmpty(n.body)) alm.borrarNota(id)
    }
    DisposableEffect(id) { onDispose { alSalir() } }
    LaunchedEffect(id) { if (nueva) { delay(250); ed.focoAlFinal() } }

    /* Elegir una foto → subirla → insertarla donde estaba el cursor. */
    var trasBloque by remember { mutableStateOf<Long?>(null) }
    val elegirFoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        ui.avisar("Subiendo la imagen…")
        ambito.launch {
            try {
                val mime = ctx.contentResolver.getType(uri) ?: "image/jpeg"
                val nombre = ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "imagen.jpg"
                val bytes = withContext(Dispatchers.IO) { ctx.contentResolver.openInputStream(uri)!!.use { it.readBytes() } }
                if (bytes.size > 25 * 1024 * 1024) { ui.avisar("La imagen pesa más de 25 MB"); return@launch }
                guardar()
                val adj = alm.subirImagen(id, nombre, mime, bytes)
                ed.imagen("attachments/$adj", trasBloque)
                ui.aviso = null
            } catch (e: ErrorApi) { ui.avisar(if (e.status == 0) "Sin conexión: la imagen no se pudo subir" else "No se pudo subir: ${e.message}") }
            catch (e: Exception) { ui.avisar("No se pudo leer la imagen") }
        }
    }

    val lista = rememberLazyListState()
    /* Si el foco va a un bloque que no está en pantalla, se trae. */
    LaunchedEffect(ed.focoPendiente) {
        val f = ed.focoPendiente ?: return@LaunchedEffect
        val i = ed.bloques.indexOfFirst { it.id == f.first } + 1
        if (i > 0 && lista.layoutInfo.visibleItemsInfo.none { it.index == i }) lista.scrollToItem(i)
    }

    Column(Modifier.fillMaxSize().background(C.surface).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp).padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            BotonIcono(Ico.back) { ui.atras() }
            Spacer(Modifier.weight(1f))
            if (!soloLectura) {
                BotonIcono(Ico.share) {
                    guardar()
                    ui.menu(null, listOf(
                        ItemMenu(if (nota.share.isEmpty()) "Compartir enlace público" else "Enlace público…", Ico.link) { ui.hoja = { HojaCompartir(alm, ui, id) } },
                        ItemMenu("Enviar el texto…", Ico.share) { alm.datos.nota(id)?.let { enviarTexto(ctx, it) } },
                        ItemMenu("Copiar como Markdown", Ico.code) {
                            ctx.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Markdown", ed.markdown()))
                            ui.avisar("Markdown copiado")
                        },
                    ))
                }
                BotonIcono(Ico.more) { guardar(); foco.clearFocus(); ui.menu(null, menuNota(alm, ui, id)) }
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = lista, contentPadding = PaddingValues(start = M.gutter, end = M.gutter, top = 4.dp)) {
            item(key = "meta", contentType = "meta") {
                Column(Modifier.padding(bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Chip(alm.datos.carpeta(nota.folder)?.name ?: "Notas", icono = Ico.folder, fondo = C.surface2) { if (!soloLectura) ui.hoja = { HojaMover(alm, ui, id) } }
                    Texto(
                        "${Fechas.nice(nota.updated, withTime = true)} · ${Derive.charCount(nota.plain)} caracteres" + (if (nota.pinned) " · fijada" else "") +
                            (if (nota.share.isNotEmpty()) " · compartida" else "") + (if (soloLectura) " · en la papelera" else ""),
                        Modifier.padding(start = 4.dp), size = 13.sp, color = C.muted,
                    )
                }
            }
            itemsIndexed(ed.bloques, key = { _, b -> b.id }, contentType = { _, b -> b.kind }) { i, b ->
                BloqueVista(ed, b, primero = i == 0, tam = ui.tamEditor, alm = alm, ui = ui, soloLectura = soloLectura)
            }
            /* El hueco de debajo: tocarlo sigue escribiendo al final. */
            item(key = "final", contentType = "final") { Box(Modifier.fillMaxWidth().height(320.dp).toque(activo = !soloLectura) { ed.focoAlFinal() }) }
        }
        if (!soloLectura && ed.enfocado != null) BarraFormato(ed, alAnadirImagen = {
            trasBloque = ed.enfocado
            elegirFoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }, alCerrar = { foco.clearFocus() })
        else Spacer(Modifier.windowInsetsPadding(WindowInsets.navigationBars))
    }
}

/**
 * La barra de formato de HyperOS: una fila sobre el teclado que se desliza en
 * horizontal, por grupos, con la X al final. La «T» despliega el formato de
 * texto. Tocar un botón no le quita el foco al campo.
 */
@Composable
private fun BarraFormato(ed: Editor, alAnadirImagen: () -> Unit, alCerrar: () -> Unit) {
    var texto by remember { mutableStateOf(false) }
    val b = ed.actual()
    val kind = b?.kind
    /* Qué marcas hay bajo el cursor (para encender B, I, U, S). */
    val marcas = remember(b?.valor) {
        val v = b?.valor ?: return@remember emptySet()
        if (b.kind == Kind.CODE) emptySet() else Inline.parse(v.text).spans.filter { v.selection.min >= it.start && v.selection.max <= it.end }.mapTo(HashSet()) { it.mark }
    }
    Row(
        Modifier.fillMaxWidth().background(C.surface).windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime)).height(52.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            Boton(Ico.undo, activo = ed.puedeDeshacer) { ed.deshacer() }
            Boton(Ico.redo, activo = ed.puedeRehacer) { ed.rehacer() }
            Sep()
            Boton(Ico.image, alPulsar = alAnadirImagen)
            Boton(Ico.todo, encendido = kind == Kind.TODO) { ed.tipo(Kind.TODO) }
            Boton(Ico.text, encendido = texto) { texto = !texto }
            if (texto) {
                Sep()
                Boton(Ico.h1, encendido = kind == Kind.H1) { ed.tipo(Kind.H1) }
                Boton(Ico.h2, encendido = kind == Kind.H2) { ed.tipo(Kind.H2) }
                Boton(Ico.h3, encendido = kind == Kind.H3) { ed.tipo(Kind.H3) }
                Sep()
                Boton(Ico.bold, encendido = Mark.STRONG in marcas) { ed.marca("**") }
                Boton(Ico.italic, encendido = Mark.EM in marcas) { ed.marca("*") }
                Boton(Ico.underline, encendido = Mark.UNDERLINE in marcas) { ed.marca("++") }
                Boton(Ico.strike, encendido = Mark.STRIKE in marcas) { ed.marca("~~") }
                Sep()
                Boton(Ico.bullet, encendido = kind == Kind.BULLET) { ed.tipo(Kind.BULLET) }
                Boton(Ico.ordered, encendido = kind == Kind.ORDERED) { ed.tipo(Kind.ORDERED) }
                Sep()
                Boton(Ico.quote, encendido = kind == Kind.QUOTE) { ed.tipo(Kind.QUOTE) }
                Boton(Ico.code, encendido = kind == Kind.CODE) { ed.tipo(Kind.CODE) }
                Boton(Ico.hr) { ed.separador() }
                Sep()
                Boton(Ico.indent, activo = ed.puedeSangrar(b, 1)) { ed.sangria(1) }
                Boton(Ico.outdent, activo = ed.puedeSangrar(b, -1)) { ed.sangria(-1) }
            }
        }
        Box(Modifier.width(1.dp).height(26.dp).background(C.hair))
        Box(Modifier.width(50.dp).height(52.dp).toque(alPulsar = alCerrar), contentAlignment = Alignment.Center) { Icono(Ico.close, size = 23.dp) }
    }
}

@Composable
private fun Boton(iv: ImageVector, encendido: Boolean = false, activo: Boolean = true, alPulsar: () -> Unit) {
    Box(
        Modifier.size(42.dp, 40.dp).clip(RoundedCornerShape(12.dp)).background(if (encendido) C.accentSoft else Color.Transparent).toque(activo = activo, alPulsar = alPulsar),
        contentAlignment = Alignment.Center,
    ) { Icono(iv, tint = (if (encendido) C.tagInk else C.text).copy(alpha = if (activo) 1f else 0.3f), size = 23.dp) }
}

@Composable
private fun Sep() { Box(Modifier.padding(horizontal = 4.dp).width(1.dp).height(22.dp).background(C.hair2)) }
