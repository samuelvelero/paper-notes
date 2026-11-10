package com.samukis.papernotes.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.samukis.papernotes.core.Fechas
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Los datos de la app y su sincronización. Es el sync.js de la web con la
 * forma de la app de tareas: todo en memoria (una foto inmutable, `datos`),
 * SQLite para volver a arrancar, una cola de lo que falta por subir y el
 * tiempo real de PocketBase mientras la app está a la vista.
 *
 * Reglas (las que costó aprender en tareas):
 *  - Se escribe SOLO por aquí, y siempre en el hilo principal: la pantalla
 *    cambia al instante y la red va detrás.
 *  - La cola no guarda cuerpos sino MARCAS (nuevo / sucio / borrado): lo que
 *    se sube es el registro como esté en ese momento. Editar diez veces sin
 *    red es una subida.
 *  - Lo que está por subir es sagrado: ni una carga ni un evento del tiempo
 *    real lo pisan.
 *  - Una carga es una foto de cuando EMPEZÓ: no borra ni pisa lo que se tocó
 *    mientras tanto (`tocados`), y solo acepta lo que no es más viejo.
 */
class Almacen(private val ctx: Context) {
    private enum class Op { NUEVO, SUCIO, BORRADO }
    private class Pend(var op: Op, var cuerpo: Boolean, var rev: Int = 1, var fallos: Int = 0)

    private val json = Json { ignoreUnknownKeys = true }
    private val prefs = ctx.getSharedPreferences("sesion", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val disco = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val db = Db(ctx)
    private val pend = LinkedHashMap<String, Pend>()   // "kind:id"
    private val enVuelo = HashSet<String>()
    private val tocados = HashSet<String>()            // ids escritos durante una carga
    private var ultimaSync: String? = null

    var sesion by mutableStateOf(leerSesion()); private set
    var datos by mutableStateOf(Datos.VACIO); private set
    /** Cuántos registros faltan por subir, y si el último intento no tuvo red. */
    var pendientes by mutableIntStateOf(0); private set
    var sinRed by mutableStateOf(false); private set
    /** `users.settings.autoTitle`: la primera línea de una nota nueva ya es Título. */
    var tituloAuto by mutableStateOf(prefs.getBoolean("autoTitle", true)); private set
    /** El disco está leído: antes de esto no se escribe (se pisaría lo guardado). */
    val cargado = CompletableDeferred<Unit>()
    /** Avisos para el usuario (una subida rechazada, la sesión caducada). */
    val avisos = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** Lo llama tras cada cambio de datos: los widgets se repintan desde aquí. */
    var alCambiar: (() -> Unit)? = null

    private var baseEntrada = ""
    val api = Api({ sesion?.base ?: baseEntrada }, { sesion?.token })

    init {
        scope.launch {
            val leido = withContext(disco) {
                val n = db.registros("notes").mapNotNull { runCatching { json.decodeFromString<Nota>(it) }.getOrNull() }
                val c = db.registros("folders").mapNotNull { runCatching { json.decodeFromString<Carpeta>(it) }.getOrNull() }
                val a = db.registros("attachments").mapNotNull { runCatching { json.decodeFromString<Adjunto>(it) }.getOrNull() }
                Triple(Datos(n, c, a.associateBy { it.id }), db.pendientes(), db.meta("ultimaSync"))
            }
            datos = leido.first
            for (p in leido.second) pend["${p[0]}:${p[1]}"] = Pend(Op.valueOf(p[2]), p[3] == "1")
            pendientes = pend.size
            ultimaSync = leido.third
            cargado.complete(Unit)
        }
        runCatching {
            ctx.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                /* Vuelve la red (o cambia de Wi-Fi a datos): se sube lo pendiente
                   y se rehace el tiempo real, que si no se queda sordo. */
                override fun onAvailable(network: Network) { scope.launch { if (visible) { pararTiempoReal(); arrancarTiempoReal() } else subir() } }
            })
        }
    }

    // ─────────────── sesión ───────────────

    private fun leerSesion(): Sesion? {
        val t = prefs.getString("token", null) ?: return null
        return Sesion(prefs.getString("base", "")!!, t, prefs.getString("uid", "")!!, prefs.getString("email", "")!!)
    }
    private fun guardarSesion(s: Sesion?) {
        prefs.edit().apply {
            if (s == null) remove("token") else { putString("base", s.base); putString("token", s.token); putString("uid", s.uid); putString("email", s.email) }
        }.apply()
        sesion = s
    }

    /** Entra con una cuenta de `users`. Lanza ErrorApi con el motivo. */
    suspend fun entrar(base: String, email: String, pass: String) {
        cargado.await()
        baseEntrada = base.trim().trimEnd('/').let { if (it.startsWith("http")) it else "https://$it" }
        val s = api.entrar(email.trim(), pass)
        /* Otra cuenta (u otro servidor) que la última: lo local no es suyo. */
        val dueno = "${s.base}|${s.uid}"
        if (prefs.getString("dueno", null) != dueno) { vaciarLocal(); prefs.edit().putString("dueno", dueno).apply() }
        guardarSesion(s)
        /* En el ámbito del almacén, no en el de quien llama: la pantalla de
           entrada desaparece en cuanto hay sesión y se llevaría la descarga. */
        scope.launch { bajar(); if (visible) arrancarTiempoReal() }
    }

    fun salir() {
        pararTiempoReal()
        guardarSesion(null)
        prefs.edit().remove("dueno").apply()
        scope.launch { vaciarLocal() }
    }
    private suspend fun vaciarLocal() {
        pend.clear(); pendientes = 0; ultimaSync = null
        escribir(Datos.VACIO)
        withContext(disco) { db.vaciar() }
    }

    val haySesion get() = sesion != null

    // ─────────────── escribir ───────────────

    private fun escribir(d: Datos) { datos = d; alCambiar?.invoke() }
    private fun alDisco(f: Db.() -> Unit) { scope.launch(disco) { runCatching { db.f() } } }

    private fun marcar(kind: String, id: String, op: Op, cuerpo: Boolean = false) {
        val k = "$kind:$id"
        tocados += id
        val p = pend[k]
        if (p != null && p.op == Op.NUEVO && op == Op.BORRADO && k !in enVuelo) {
            /* Nació y murió sin llegar al servidor: no hay nada que subir. */
            pend.remove(k); alDisco { quitarPend(kind, id) }
        } else {
            val q = if (p == null) Pend(op, cuerpo).also { pend[k] = it } else p.apply {
                rev++; fallos = 0; this.cuerpo = this.cuerpo || cuerpo
                this.op = if (op == Op.BORRADO) Op.BORRADO else if (this.op == Op.NUEVO) Op.NUEVO else op
            }
            val (o, c) = q.op.name to q.cuerpo
            alDisco { ponerPend(kind, id, o, c) }
        }
        pendientes = pend.size
        programarSubida()
    }

    private fun ponerNota(n: Nota) {
        val i = datos.notas.indexOfFirst { it.id == n.id }
        escribir(Datos(if (i < 0) listOf(n) + datos.notas else datos.notas.toMutableList().also { it[i] = n }, datos.carpetas, datos.adjuntos))
        val s = json.encodeToString(n)
        alDisco { poner("notes", n.id, s) }
    }
    private fun quitarNota(id: String) {
        escribir(Datos(datos.notas.filter { it.id != id }, datos.carpetas, datos.adjuntos))
        alDisco { quitar("notes", id) }
    }
    private fun ponerCarpeta(c: Carpeta) {
        val i = datos.carpetas.indexOfFirst { it.id == c.id }
        escribir(Datos(datos.notas, if (i < 0) datos.carpetas + c else datos.carpetas.toMutableList().also { it[i] = c }, datos.adjuntos))
        val s = json.encodeToString(c)
        alDisco { poner("folders", c.id, s) }
    }

    /** Una nota nueva. Con `tituloAuto` y sin texto, nace con la línea de título. */
    fun nuevaNota(carpeta: String = "", cuerpo: String? = null): Nota {
        val ahora = ahora()
        val n = Nota(id = genId(), folder = carpeta, created = ahora).conCuerpo(cuerpo ?: if (tituloAuto) "# " else "", ahora)
        ponerNota(n)
        marcar("notes", n.id, Op.NUEVO)
        return n
    }
    /** Cambia una nota. `cuerpo` = cambió el texto (sube con `base_version`). */
    fun cambiarNota(id: String, cuerpo: Boolean = false, f: (Nota) -> Nota) {
        val n = datos.nota(id) ?: return
        val m = f(n)
        if (m == n) return
        ponerNota(m)
        marcar("notes", id, Op.SUCIO, cuerpo)
    }
    fun guardarCuerpo(id: String, md: String) = cambiarNota(id, cuerpo = true) { if (it.body == md) it else it.conCuerpo(md, ahora()) }
    fun aPapelera(id: String) = cambiarNota(id) { it.copy(trashedAt = ahora(), pinned = false) }
    fun restaurar(id: String) = cambiarNota(id) { it.copy(trashedAt = "") }
    fun mover(id: String, carpeta: String) = cambiarNota(id) { it.copy(folder = carpeta) }
    /** Borra para siempre (la papelera, o una nota nueva que se quedó vacía). */
    fun borrarNota(id: String) {
        if (datos.nota(id) == null) return
        quitarNota(id)
        marcar("notes", id, Op.BORRADO)
    }

    fun nuevaCarpeta(nombre: String, parent: String = ""): Carpeta {
        val c = Carpeta(genId(), nombre.trim(), parent, System.currentTimeMillis().toString())
        ponerCarpeta(c)
        marcar("folders", c.id, Op.NUEVO)
        return c
    }
    fun renombrarCarpeta(id: String, nombre: String) {
        val c = datos.carpeta(id) ?: return
        ponerCarpeta(c.copy(name = nombre.trim()))
        marcar("folders", id, Op.SUCIO)
    }
    /** Borra la carpeta y sus hijas; sus notas pasan a «Notas». No se borra ninguna nota. */
    fun borrarCarpeta(id: String) {
        val ids = datos.subarbol(id)
        for (n in datos.notas) if (n.folder in ids) mover(n.id, "")
        escribir(Datos(datos.notas, datos.carpetas.filter { it.id !in ids }, datos.adjuntos))
        for (c in ids) { alDisco { quitar("folders", c) }; marcar("folders", c, Op.BORRADO) }
    }

    fun ponerTituloAuto(v: Boolean) {
        tituloAuto = v
        prefs.edit().putBoolean("autoTitle", v).apply()
        val uid = sesion?.uid ?: return
        scope.launch { runCatching { api.parchear("users", uid, JsonObject(mapOf("settings" to JsonObject(mapOf("autoTitle" to JsonPrimitive(v)))))) } }
    }

    /** Sube una imagen a una nota. Necesita conexión: devuelve el id del
     *  adjunto (para `![](attachments/<id>)`) o lanza ErrorApi. */
    suspend fun subirImagen(nota: String, nombre: String, mime: String, bytes: ByteArray): String {
        if (pend["notes:$nota"]?.op == Op.NUEVO) subir()   // la nota tiene que existir en el servidor
        val id = genId()
        val a = adjuntoDe(api.subirAdjunto(id, nota, nombre, mime, bytes))
        escribir(Datos(datos.notas, datos.carpetas, datos.adjuntos + (a.id to a)))
        val s = json.encodeToString(a)
        alDisco { poner("attachments", a.id, s) }
        return a.id
    }
    fun urlAdjunto(id: String, miniatura: String? = "800x0"): String? {
        val a = datos.adjuntos[id] ?: return null
        val base = sesion?.base ?: return null
        return "$base/api/files/attachments/${a.id}/${URLEncoder.encode(a.file, "UTF-8").replace("+", "%20")}" + (miniatura?.let { "?thumb=$it" } ?: "")
    }

    // ─────────────── subir ───────────────

    private var subida: Job? = null
    private var subiendo = false
    private fun programarSubida(ms: Long = 600) {
        subida?.cancel()
        subida = scope.launch { delay(ms); subir() }
    }

    suspend fun subir() {
        if (subiendo || sesion == null) return
        subiendo = true
        var quedaTrabajo = false
        try {
            /* Las carpetas antes que las notas que viven en ellas, y las madres
               antes que las hijas; los borrados de carpeta, al final. */
            fun peso(k: String): Int {
                val p = pend[k] ?: return 0
                if (!k.startsWith("folders:")) return 100
                if (p.op == Op.BORRADO) return 200
                var prof = 0; var c = datos.carpeta(k.substringAfter(':'))
                while (c != null && c.parent.isNotEmpty() && prof < 50) { prof++; c = datos.carpeta(c.parent) }
                return prof
            }
            for (k in pend.keys.sortedBy(::peso)) {
                val p = pend[k] ?: continue
                val kind = k.substringBefore(':'); val id = k.substringAfter(':')
                val rev = p.rev
                enVuelo += k
                try {
                    val res = subirUno(kind, id, p)
                    sinRed = false
                    if (p.rev == rev) {
                        pend.remove(k)
                        withContext(disco) { db.quitarPend(kind, id) }
                        if (res != null) aplicar(kind, res)
                    } else {
                        /* Se volvió a tocar mientras subía: sigue sucio, pero ya
                           existe en el servidor y su versión es la de la respuesta. */
                        if (p.op == Op.NUEVO) p.op = Op.SUCIO
                        if (res != null && kind == "notes") {
                            val v = (res["version"] as? JsonPrimitive)?.intOrNull
                            val n = datos.nota(id)
                            if (v != null && n != null && n.version != v) ponerNota(n.copy(version = v))
                        }
                        quedaTrabajo = true
                    }
                } catch (e: ErrorApi) {
                    if (e.status == 0) { sinRed = true; break }
                    if (e.status == 401) { avisos.tryEmit("La sesión caducó: vuelve a entrar"); break }
                    /* Un rechazo que no se arregla solo se suelta al tercer
                       intento: el registro vuelve a ser el del servidor. */
                    if (++p.fallos >= 3) {
                        pend.remove(k)
                        withContext(disco) { db.quitarPend(kind, id) }
                        avisos.tryEmit("No se pudo guardar un cambio: ${e.message}")
                        runCatching { api.leer(kind, id) }.getOrNull()?.let { aplicar(kind, it) }
                    } else quedaTrabajo = true
                } finally { enVuelo -= k }
            }
        } finally {
            subiendo = false
            pendientes = pend.size
        }
        if (quedaTrabajo) programarSubida(2500)
    }

    private suspend fun subirUno(kind: String, id: String, p: Pend): JsonObject? {
        if (p.op == Op.BORRADO) {
            try { api.borrar(kind, id) } catch (e: ErrorApi) { if (e.status != 404) throw e }
            return null
        }
        val cuerpo: JsonObject = when (kind) {
            "notes" -> {
                val n = datos.nota(id) ?: return null
                val m = n.alCable().toMutableMap()
                if (p.cuerpo && p.op == Op.SUCIO) m["base_version"] = JsonPrimitive(n.version)
                JsonObject(m)
            }
            else -> (datos.carpeta(id) ?: return null).alCable()
        }
        val conId = JsonObject(cuerpo + ("id" to JsonPrimitive(id)) - "base_version")
        return if (p.op == Op.NUEVO) {
            try { api.crear(kind, conId) } catch (e: ErrorApi) { if (e.status == 400) api.parchear(kind, id, cuerpo) else throw e }
        } else {
            try { api.parchear(kind, id, cuerpo) } catch (e: ErrorApi) { if (e.status == 404) api.crear(kind, conId) else throw e }
        }
    }

    /** Un registro del servidor pasa a ser la verdad local. */
    private fun aplicar(kind: String, r: JsonObject) {
        when (kind) {
            "notes" -> ponerNota(notaDe(r))
            "folders" -> ponerCarpeta(carpetaDe(r))
        }
    }

    // ─────────────── bajar ───────────────

    private var bajando = false
    /**
     * Trae lo que cambió. La primera vez, todo; después solo lo modificado
     * desde la última marca más la lista de ids (PocketBase no avisa de los
     * borrados): dos peticiones pequeñas en vez de todos los cuerpos.
     */
    suspend fun bajar() {
        if (bajando || sesion == null) return
        cargado.await()
        bajando = true
        tocados.clear()
        try {
            val marca = ultimaSync
            val completa = marca == null
            val notas = api.listar("notes", filtro = marca?.let { "updated >= \"$it\"" }).map(::notaDe)
            val ids = if (completa) notas.mapTo(HashSet()) { it.id } else api.listar("notes", campos = "id", porPagina = 1000).mapTo(HashSet()) { it["id"].txt }
            val carpetas = api.listar("folders").map(::carpetaDe)
            val adjuntos = api.listar("attachments", filtro = marca?.let { "updated >= \"$it\"" }, campos = "id,note,file").map(::adjuntoDe)
            sinRed = false

            val locales = datos.notas.associateByTo(LinkedHashMap()) { it.id }
            val cambiadas = ArrayList<Nota>()
            for (n in notas) {
                if ("notes:${n.id}" in pend || n.id in tocados) continue
                val l = locales[n.id]
                if (l != null && l.updated > n.updated) continue   // lo nuestro ya es más nuevo (acaba de subir)
                if (l != n) { locales[n.id] = n; cambiadas += n }
            }
            val idas = locales.keys.filter { it !in ids && "notes:$it" !in pend && it !in tocados }
            idas.forEach { locales.remove(it) }

            val cLocales = datos.carpetas.associateByTo(LinkedHashMap()) { it.id }
            val cIds = carpetas.mapTo(HashSet()) { it.id }
            for (c in carpetas) if ("folders:${c.id}" !in pend && c.id !in tocados) cLocales[c.id] = c
            val cIdas = cLocales.keys.filter { it !in cIds && "folders:$it" !in pend && it !in tocados }
            cIdas.forEach { cLocales.remove(it) }

            val aTodos = if (completa) adjuntos.associateBy { it.id } else datos.adjuntos + adjuntos.associateBy { it.id }
            val nuevaMarca = (notas.maxOfOrNull { it.updated } ?: marca)?.takeIf { it.isNotEmpty() } ?: marca

            escribir(Datos(locales.values.sortedByDescending { it.updated }, cLocales.values.toList(), aTodos))
            ultimaSync = nuevaMarca
            val cs = cLocales.values.map { it.id to json.encodeToString(it) }
            val ns = cambiadas.map { it.id to json.encodeToString(it) }
            val ads = adjuntos.map { it.id to json.encodeToString(it) }
            withContext(disco) {
                db.lote {
                    for ((id, s) in ns) db.poner("notes", id, s)
                    for (id in idas) db.quitar("notes", id)
                    for ((id, s) in cs) db.poner("folders", id, s)
                    for (id in cIdas) db.quitar("folders", id)
                    for ((id, s) in ads) db.poner("attachments", id, s)
                    db.meta("ultimaSync", nuevaMarca)
                }
            }
        } catch (e: ErrorApi) {
            if (e.status == 0) sinRed = true else android.util.Log.w("Paper", "bajar: ${e.status} ${e.message}")
        } catch (e: kotlinx.coroutines.CancellationException) { throw e
        } catch (e: Exception) {
            /* Un fallo al fundir no debe tumbar a quien llama (la entrada, el tiempo real). */
            android.util.Log.e("Paper", "bajar", e)
        } finally { bajando = false }
    }

    /** Renueva el token y lee los ajustes de la cuenta. Si la sesión ya no
     *  vale, se vuelve a la pantalla de entrada (lo local se queda). */
    private suspend fun renovar() {
        val ahora = System.currentTimeMillis()
        if (ahora - prefs.getLong("renovado", 0) < 12 * 3600_000L) return
        try {
            val d = api.renovar()
            if (d == null) { guardarSesion(null); avisos.tryEmit("La sesión caducó: vuelve a entrar"); return }
            val s = sesion ?: return
            d["token"].s?.let { guardarSesion(s.copy(token = it)) }
            (((d["record"] as? JsonObject)?.get("settings") as? JsonObject)?.get("autoTitle") as? JsonPrimitive)?.booleanOrNull?.let {
                tituloAuto = it; prefs.edit().putBoolean("autoTitle", it).apply()
            }
            prefs.edit().putLong("renovado", ahora).apply()
        } catch (_: ErrorApi) { }
    }

    // ─────────────── tiempo real ───────────────

    private var visible = false
    private var tiempoReal: Job? = null

    /** La app pasa a primer plano. */
    fun alVolver() { visible = true; arrancarTiempoReal() }
    /** La app deja de verse: se suelta el tiempo real (la batería) y se sube lo que quede. */
    fun alIrse() { visible = false; pararTiempoReal(); scope.launch { subir() } }

    private fun pararTiempoReal() { tiempoReal?.cancel(); tiempoReal = null }
    private fun arrancarTiempoReal() {
        if (tiempoReal != null || sesion == null) return
        tiempoReal = scope.launch {
            cargado.await()
            renovar()
            var espera = 2000L
            while (isActive && sesion != null) {
                var conecto = false
                api.tiempoReal(listOf("notes", "folders", "attachments"),
                    /* Cada (re)conexión se pone al día: lo que pasó mientras no escuchaba. */
                    onConectado = { conecto = true; scope.launch { bajar(); subir() } },
                    onEvento = { col, msg -> scope.launch { evento(col, msg) } })
                if (!conecto) sinRed = true
                espera = if (conecto) 2000L else minOf(espera * 2, 30_000L)
                delay(espera)
            }
        }
    }

    private fun evento(col: String, msg: JsonObject) {
        val r = msg["record"] as? JsonObject ?: return
        val id = r["id"].txt
        if ("$col:$id" in pend) return   // lo local sin subir manda
        val borrado = msg["action"].txt == "delete"
        when (col) {
            "notes" -> if (borrado) { if (datos.nota(id) != null) quitarNota(id) } else {
                val n = notaDe(r); val l = datos.nota(id)
                if (l == null || n.updated >= l.updated) { if (l != n) ponerNota(n) }
            }
            "folders" -> if (borrado) {
                escribir(Datos(datos.notas, datos.carpetas.filter { it.id != id }, datos.adjuntos)); alDisco { quitar("folders", id) }
            } else ponerCarpeta(carpetaDe(r))
            "attachments" -> if (!borrado) {
                val a = adjuntoDe(r)
                escribir(Datos(datos.notas, datos.carpetas, datos.adjuntos + (a.id to a)))
                val s = json.encodeToString(a)
                alDisco { poner("attachments", a.id, s) }
            }
        }
    }

    /** Para el trabajo en segundo plano (widgets al día con la app cerrada). */
    suspend fun refrescar() { cargado.await(); if (sesion == null) return; bajar(); subir() }

    companion object {
        private val azar = SecureRandom()
        private const val ABC = "abcdefghijklmnopqrstuvwxyz0123456789"
        fun genId() = buildString { repeat(15) { append(ABC[azar.nextInt(ABC.length)]) } }
        /** El formato de fecha de PocketBase ("2026-11-10 16:21:05.123Z"): así
         *  lo local y lo del servidor se comparan y ordenan como texto. */
        fun ahora() = Fechas.ahoraPb()
        /** Token de un enlace público: 128 bits, base64url. */
        fun tokenCompartir(): String {
            val b = ByteArray(16).also { azar.nextBytes(it) }
            return android.util.Base64.encodeToString(b, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP)
        }
    }
}
