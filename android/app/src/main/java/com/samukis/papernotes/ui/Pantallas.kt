package com.samukis.papernotes.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.samukis.papernotes.BuildConfig
import com.samukis.papernotes.R
import com.samukis.papernotes.core.Derive
import com.samukis.papernotes.core.Fechas
import com.samukis.papernotes.data.Almacen
import com.samukis.papernotes.data.mensajeDeEntrada
import kotlinx.coroutines.launch

/** La raíz: la pantalla de arriba de la pila, y encima la hoja y el aviso. */
@Composable
fun Raiz(alm: Almacen, ui: Ui) {
    Box(Modifier.fillMaxSize().background(C.bg)) {
        if (!alm.haySesion) Entrada(alm, ui)
        else AnimatedContent(
            targetState = ui.actual,
            transitionSpec = {
                val d = if (ui.adelante) 1 else -1
                (slideInHorizontally(Motion.estandar()) { d * it / 5 } + fadeIn(tween(160))) togetherWith
                    (slideOutHorizontally(Motion.estandar()) { -d * it / 8 } + fadeOut(tween(110)))
            },
            contentKey = { if (it is Pantalla.Nota) "nota-${it.id}" else it },
            label = "pantalla",
        ) { p ->
            when (p) {
                Pantalla.Lista -> PantallaLista(alm, ui)
                Pantalla.Carpetas -> PantallaCarpetas(alm, ui)
                Pantalla.Ajustes -> PantallaAjustes(alm, ui)
                Pantalla.Papelera -> PantallaPapelera(alm, ui)
                is Pantalla.Nota -> PantallaNota(alm, ui, p.id, p.nueva)
            }
        }
        CapaHoja(ui)
        CapaAviso(ui, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().imePadding().padding(bottom = 100.dp))
    }
    BackHandler(enabled = ui.hoja != null || ui.pila.size > 1) { ui.atras() }
    LaunchedEffect(Unit) { alm.avisos.collect { ui.avisar(it) } }
}

// ─────────────── entrada ───────────────

@Composable
fun Entrada(alm: Almacen, ui: Ui) {
    var servidor by remember { mutableStateOf(TextFieldValue(BuildConfig.SERVIDOR)) }
    var correo by remember { mutableStateOf(TextFieldValue("")) }
    var clave by remember { mutableStateOf(TextFieldValue("")) }
    var error by remember { mutableStateOf("") }
    var entrando by remember { mutableStateOf(false) }
    val ambito = rememberCoroutineScope()
    fun entrar() {
        if (entrando) return
        if (servidor.text.isBlank()) { error = "Escribe la dirección de tu servidor de Paper Notes."; return }
        if (correo.text.isBlank() || clave.text.isEmpty()) return
        entrando = true; error = ""
        ambito.launch {
            try { alm.entrar(servidor.text, correo.text, clave.text); ui.reiniciar() }
            catch (e: Exception) { error = mensajeDeEntrada(e) }
            finally { entrando = false }
        }
    }
    Box(Modifier.fillMaxSize().background(C.bg).statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 380.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(C.surface).padding(horizontal = 26.dp, vertical = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Image(painterResource(R.drawable.logo), null, Modifier.size(64.dp).clip(RoundedCornerShape(18.dp)))
            Texto("Paper Notes", Modifier.padding(top = 6.dp), size = 24.sp, weight = FontWeight.Medium)
            Texto("Entra con tu cuenta", Modifier.padding(bottom = 10.dp), size = 14.sp, color = C.muted)
            Campo(servidor, { servidor = it }, "https://tu-servidor", opciones = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next))
            Campo(correo, { correo = it }, "correo", opciones = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next))
            Campo(clave, { clave = it }, "contraseña", opciones = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done), oculto = true, alTerminar = ::entrar)
            Texto(error, Modifier.heightIn(min = 18.dp), size = 13.sp, color = C.danger, align = TextAlign.Center)
            Box(
                Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(14.dp)).background(C.accent.copy(alpha = if (entrando) 0.5f else 1f)).toque(activo = !entrando, alPulsar = ::entrar),
                contentAlignment = Alignment.Center,
            ) { Texto(if (entrando) "Entrando…" else "Entrar", size = 16.sp, weight = FontWeight.SemiBold, color = C.accentInk) }
        }
    }
}

// ─────────────── carpetas ───────────────

@Composable
fun PantallaCarpetas(alm: Almacen, ui: Ui) {
    val datos = alm.datos
    val filas = remember(datos) {
        val out = ArrayList<Triple<String, String, Int>>()
        fun rec(parent: String, prof: Int) { for (c in datos.hijas(parent)) { out += Triple(c.id, c.name, prof); rec(c.id, prof + 1) } }
        rec("", 0)
        out
    }
    Column(Modifier.fillMaxSize().background(C.bg).statusBarsPadding()) {
        Box(Modifier.padding(horizontal = 12.dp).padding(top = 6.dp)) {
            CabeceraCentrada("Carpetas", { ui.atras() }) { BotonIcono(Ico.trash) { ui.ir(Pantalla.Papelera) } }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = M.gutter, end = M.gutter, top = 10.dp, bottom = 60.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "todo") { TarjetaCarpeta("Todo", datos.activas.size, ui.carpeta == null, 0, null) { ui.aLista(null) } }
            item(key = "sueltas") { TarjetaCarpeta("Notas", datos.activas.count { it.folder.isEmpty() }, ui.carpeta == "", 0, null) { ui.aLista("") } }
            items(filas, key = { it.first }) { (id, nombre, prof) ->
                TarjetaCarpeta(nombre, remember(datos, id) { datos.cuenta(id) }, ui.carpeta == id, prof, alMantener = { ui.menu(nombre, menuCarpeta(alm, ui, id)) }) { ui.aLista(id) }
            }
            item(key = "nueva") {
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.surface).toque { ui.pedirTexto("Nueva carpeta") { alm.nuevaCarpeta(it) } }.padding(vertical = 18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(C.accent), contentAlignment = Alignment.Center) { Icono(Ico.plus, tint = C.accentInk, size = 22.dp) }
                    Texto("Nueva carpeta", size = 16.sp, color = C.text2)
                }
            }
        }
    }
}

@Composable
private fun TarjetaCarpeta(nombre: String, cuenta: Int, activa: Boolean, prof: Int, alMantener: (() -> Unit)?, alPulsar: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 60.dp).clip(RoundedCornerShape(18.dp)).background(C.surface).toque(alMantener = alMantener, alPulsar = alPulsar)
            .padding(start = (14 + prof * 18).dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(24.dp)) { if (activa) Icono(Ico.check, tint = C.accent) }
        Spacer(Modifier.width(10.dp))
        Texto(nombre, Modifier.weight(1f), size = 16.sp, maxLines = 1)
        Texto(cuenta.toString(), size = 14.sp, color = C.muted)
    }
}

fun menuCarpeta(alm: Almacen, ui: Ui, id: String): List<ItemMenu> {
    val c = alm.datos.carpeta(id) ?: return emptyList()
    return listOf(
        ItemMenu("Nueva nota aquí", Ico.plus) { ui.aLista(id); val n = alm.nuevaNota(id); ui.abrirNota(n.id, nueva = true) },
        ItemMenu("Renombrar", Ico.text) { ui.pedirTexto("Renombrar carpeta", c.name) { alm.renombrarCarpeta(id, it) } },
        ItemMenu("Nueva subcarpeta", Ico.folder) { ui.pedirTexto("Nueva subcarpeta") { alm.nuevaCarpeta(it, id) } },
        ItemMenu("Mover las notas a Notas y borrar", Ico.trash, peligro = true) {
            ui.confirmar("¿Borrar la carpeta «${c.name}»?", "Sus notas (y las de sus subcarpetas) pasan a «Notas». No se borra ninguna nota.", "Borrar", peligro = true) {
                if (ui.carpeta != null && ui.carpeta in alm.datos.subarbol(id)) ui.carpeta = null
                alm.borrarCarpeta(id)
            }
        },
    )
}

// ─────────────── papelera ───────────────

@Composable
fun PantallaPapelera(alm: Almacen, ui: Ui) {
    val notas = alm.datos.papelera
    Column(Modifier.fillMaxSize().background(C.bg).statusBarsPadding()) {
        Box(Modifier.padding(horizontal = 12.dp).padding(top = 6.dp)) {
            CabeceraCentrada("Eliminadas", { ui.atras() }) {
                if (notas.isNotEmpty()) BotonIcono(Ico.trash) {
                    ui.confirmar("¿Vaciar la papelera?", "Se borran ${notas.size} notas para siempre.", "Vaciar", peligro = true) { notas.forEach { alm.borrarNota(it.id) } }
                }
            }
        }
        if (notas.isEmpty()) { Vacio("La papelera está vacía."); return@Column }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = M.gutter, end = M.gutter, top = 4.dp, bottom = 60.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item(key = "pista") { Texto("Se borran solas a los 30 días.", Modifier.fillMaxWidth().padding(vertical = 8.dp), size = 13.sp, color = C.muted, align = TextAlign.Center) }
            items(notas, key = { it.id }) { n ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(M.radioTarjeta)).background(C.surface).padding(horizontal = 16.dp, vertical = 14.dp)) {
                    Texto(n.title.ifEmpty { "Sin título" }, size = 19.sp, weight = FontWeight.Medium, maxLines = 1, color = if (n.title.isEmpty()) C.muted else C.text)
                    val ex = remember(n.plain) { Derive.excerpt(n.title, n.plain) }
                    Texto(ex.ifEmpty { "Sin texto" }, Modifier.padding(top = 6.dp), size = 14.sp, color = C.text2, maxLines = 3, lineHeight = 19.5.sp)
                    Texto("eliminada ${Fechas.nice(n.trashedAt)}", Modifier.padding(top = 10.dp), size = 12.5.sp, color = C.muted)
                    Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip("Restaurar", icono = Ico.restore, fondo = C.surface2) { alm.restaurar(n.id); ui.avisar("Nota restaurada") }
                        Chip("Borrar", icono = Ico.trash, fondo = C.surface2, tinta = C.danger) {
                            ui.confirmar("¿Borrar para siempre?", "No se puede deshacer.", "Borrar", peligro = true) { alm.borrarNota(n.id) }
                        }
                    }
                }
            }
        }
    }
}

// ─────────────── ajustes ───────────────

private val FUENTES = listOf("s" to "Pequeña", "m" to "Mediana", "l" to "Grande")
private val ORDENES = listOf("updated" to "Por fecha de modificación", "created" to "Por fecha de creación", "title" to "Por título")
private val DISENOS = listOf("grid" to "Ver en cuadrícula", "list" to "Ver en lista")

@Composable
fun PantallaAjustes(alm: Almacen, ui: Ui) {
    fun elegir(titulo: String, opciones: List<Pair<String, String>>, actual: String, poner: (String) -> Unit) =
        ui.menu(titulo, opciones.map { (v, l) -> ItemMenu(l, marcado = v == actual) { poner(v) } })
    Column(Modifier.fillMaxSize().background(C.bg).statusBarsPadding()) {
        Box(Modifier.padding(horizontal = 12.dp).padding(top = 6.dp)) { CabeceraCentrada("Ajustes", { ui.atras() }) }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = M.gutter).padding(bottom = 60.dp)) {
            Seccion("Estilo")
            TarjetaAjustes {
                FilaAjuste("Tamaño de fuente", valor = FUENTES.first { it.first == ui.fuente }.second, icono = Ico.chevDown) { elegir("Tamaño de fuente", FUENTES, ui.fuente, ui::ponerFuente) }
                FilaAjuste("Ordenar", valor = ORDENES.first { it.first == ui.orden }.second, icono = Ico.chevDown) { elegir("Ordenar", ORDENES, ui.orden, ui::ponerOrden) }
                FilaAjuste("Diseño", valor = DISENOS.first { it.first == ui.diseno }.second, icono = Ico.chevDown) { elegir("Diseño", DISENOS, ui.diseno, ui::ponerDiseno) }
            }
            Seccion("Notas")
            TarjetaAjustes {
                Row(Modifier.fillMaxWidth().heightIn(min = 54.dp).toque { alm.ponerTituloAuto(!alm.tituloAuto) }.padding(horizontal = 18.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Texto("Título automático en notas nuevas", Modifier.weight(1f), size = 15.5.sp)
                    Interruptor(alm.tituloAuto)
                }
                Texto("Con el ajuste activo, la primera línea de una nota nueva ya tiene formato de título. Sin él, la nota empieza por cuerpo y el título se toma de la primera línea.",
                    Modifier.padding(start = 18.dp, end = 18.dp, bottom = 14.dp), size = 13.sp, color = C.muted, lineHeight = 18.5.sp)
            }
            Seccion("Datos")
            TarjetaAjustes {
                FilaAjuste("Elementos eliminados recientemente", valor = alm.datos.papelera.size.toString(), icono = Ico.chevron) { ui.ir(Pantalla.Papelera) }
            }
            Seccion("Cuenta")
            TarjetaAjustes {
                FilaAjuste(alm.sesion?.email ?: "", valor = "", icono = Ico.logout) {
                    val n = alm.pendientes
                    ui.confirmar("¿Cerrar sesión?", if (n > 0) "Hay $n ${if (n == 1) "cambio" else "cambios"} sin subir que se perderían." else "Las notas siguen en el servidor.", "Cerrar sesión", peligro = n > 0) { alm.salir(); ui.reiniciar() }
                }
                FilaAjuste("Servidor", valor = (alm.sesion?.base ?: "").removePrefix("https://").removePrefix("http://"), icono = null, alPulsar = null)
            }
            Seccion("App")
            TarjetaAjustes { FilaAjuste("Versión", valor = BuildConfig.VERSION_NAME, icono = null, alPulsar = null) }
        }
    }
}

@Composable
private fun TarjetaAjustes(contenido: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = 4.dp).clip(RoundedCornerShape(20.dp)).background(C.surface).padding(vertical = 4.dp)) { contenido() }
}

@Composable
private fun FilaAjuste(etiqueta: String, valor: String, icono: ImageVector?, alPulsar: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 54.dp).then(if (alPulsar != null) Modifier.toque(alPulsar = alPulsar) else Modifier).padding(horizontal = 18.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Texto(etiqueta, Modifier.weight(1f), size = 15.5.sp, maxLines = 2)
        if (valor.isNotEmpty()) Texto(valor, Modifier.padding(start = 12.dp).widthIn(max = 190.dp), size = 15.sp, color = C.text2, maxLines = 1, align = TextAlign.End)
        if (icono != null) Icono(icono, Modifier.padding(start = 4.dp), tint = C.muted, size = 20.dp)
    }
}

@Composable
private fun Interruptor(encendido: Boolean) {
    val x by androidx.compose.animation.core.animateDpAsState(if (encendido) 20.dp else 0.dp, Motion.rapido(), label = "interruptor")
    Box(Modifier.width(50.dp).height(30.dp).clip(RoundedCornerShape(15.dp)).background(if (encendido) C.accent else C.hair2).padding(3.dp)) {
        Box(Modifier.offset(x = x).size(24.dp).clip(CircleShape).background(Color.White))
    }
}
