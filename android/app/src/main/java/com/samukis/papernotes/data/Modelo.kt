package com.samukis.papernotes.data

import androidx.compose.runtime.Immutable
import com.samukis.papernotes.core.Derive
import com.samukis.papernotes.core.sNorm
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/* Los registros, tal como los usa la app. Son inmutables: cada cambio es una
   copia, y así Compose sabe qué tarjeta cambió sin comparar cuerpos. */

@Immutable @Serializable
data class Nota(
    val id: String,
    val folder: String = "",
    val body: String = "",
    val title: String = "",
    val plain: String = "",
    val tags: List<String> = emptyList(),
    val pinned: Boolean = false,
    val trashedAt: String = "",
    val version: Int = 0,
    val created: String = "",
    val updated: String = "",
    val clientUpdated: String = "",
    val share: String = "",
) {
    val enPapelera get() = trashedAt.isNotEmpty()
    /** Con el cuerpo nuevo y sus derivados (los del servidor mandarán al subir). */
    fun conCuerpo(md: String, ahora: String) = copy(body = md, title = Derive.title(md), plain = Derive.plain(md), tags = Derive.tags(md), updated = ahora, clientUpdated = ahora)
}

@Immutable @Serializable
data class Carpeta(val id: String, val name: String = "", val parent: String = "", val order: String = "")

@Immutable @Serializable
data class Adjunto(val id: String, val note: String = "", val file: String = "")

/** Una foto de todo lo que hay. Se cambia entera en cada escritura. */
@Immutable
class Datos(val notas: List<Nota>, val carpetas: List<Carpeta>, val adjuntos: Map<String, Adjunto>) {
    private val porId by lazy(LazyThreadSafetyMode.NONE) { notas.associateBy { it.id } }
    fun nota(id: String?) = if (id == null) null else porId[id]
    fun carpeta(id: String?) = carpetas.firstOrNull { it.id == id }
    val activas by lazy(LazyThreadSafetyMode.NONE) { notas.filter { !it.enPapelera } }
    val papelera by lazy(LazyThreadSafetyMode.NONE) { notas.filter { it.enPapelera }.sortedByDescending { it.trashedAt } }

    fun hijas(parent: String) = carpetas.filter { it.parent == parent }.sortedWith(compareBy<Carpeta> { it.order }.thenBy { it.name.lowercase() })
    /** `id` y todo lo que cuelga de ella. */
    fun subarbol(id: String): Set<String> {
        val out = linkedSetOf(id)
        var crecio = true
        while (crecio) { crecio = false; for (c in carpetas) if (c.parent in out && out.add(c.id)) crecio = true }
        return out
    }
    fun cuenta(carpeta: String): Int { val ids = subarbol(carpeta); return activas.count { it.folder in ids } }

    /** La lista principal. `carpeta`: null = todo, "" = las sueltas, id = esa y sus hijas. */
    fun lista(carpeta: String?, etiqueta: String?, q: String, orden: String): List<Nota> {
        var arr = activas
        if (carpeta == "") arr = arr.filter { it.folder.isEmpty() }
        else if (carpeta != null) { val ids = subarbol(carpeta); arr = arr.filter { it.folder in ids } }
        if (etiqueta != null) arr = arr.filter { etiqueta in it.tags }
        val palabras = sNorm(q).split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (palabras.isEmpty()) return arr.sortedWith(comparador(orden))
        /* Cada palabra debe aparecer en el título o el cuerpo; el título pesa más. */
        return arr.mapNotNull { n ->
            val t = sNorm(n.title); val p = sNorm(n.plain)
            var puntos = 0
            for (w in palabras) {
                val it = t.indexOf(w); val ip = p.indexOf(w)
                if (it < 0 && ip < 0) return@mapNotNull null
                if (it >= 0) puntos += if (it == 0 || t[it - 1] == ' ') 6 else 3
                if (ip >= 0) puntos += if (ip == 0 || p[ip - 1].isWhitespace()) 2 else 1
            }
            n to puntos
        }.sortedWith(compareByDescending<Pair<Nota, Int>> { it.second }.thenByDescending { it.first.updated }).map { it.first }
    }
    fun etiquetas(carpeta: String?): List<Pair<String, Int>> {
        var arr = activas
        if (carpeta == "") arr = arr.filter { it.folder.isEmpty() }
        else if (carpeta != null) { val ids = subarbol(carpeta); arr = arr.filter { it.folder in ids } }
        val m = HashMap<String, Int>()
        for (n in arr) for (t in n.tags) m[t] = (m[t] ?: 0) + 1
        return m.entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key }).map { it.key to it.value }
    }

    companion object {
        val VACIO = Datos(emptyList(), emptyList(), emptyMap())
        fun comparador(orden: String): Comparator<Nota> = when (orden) {
            "title" -> compareBy { it.title.lowercase() }
            "created" -> compareByDescending { it.created }
            else -> compareByDescending { it.updated }
        }
    }
}

// ─────────────── el cable: JSON de PocketBase ↔ registros ───────────────

internal val JsonElement?.s: String? get() = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
internal val JsonElement?.txt: String get() = s ?: ""

internal fun notaDe(r: JsonObject) = Nota(
    id = r["id"].txt, folder = r["folder"].txt, body = r["body"].txt, title = r["title"].txt, plain = r["plain"].txt,
    tags = (r["tags"] as? JsonArray)?.mapNotNull { it.s } ?: emptyList(),
    pinned = (r["pinned"] as? JsonPrimitive)?.booleanOrNull ?: false,
    trashedAt = r["trashed_at"].txt, version = (r["version"] as? JsonPrimitive)?.intOrNull ?: 0,
    created = r["created"].txt, updated = r["updated"].txt, clientUpdated = r["client_updated"].txt, share = r["share"].txt,
)
internal fun carpetaDe(r: JsonObject) = Carpeta(r["id"].txt, r["name"].txt, r["parent"].txt, r["order"].txt)
internal fun adjuntoDe(r: JsonObject) = Adjunto(r["id"].txt, r["note"].txt, r["file"].txt)

/** Solo lo que el cliente escribe: los derivados los pone el hook del servidor. */
internal fun Nota.alCable() = JsonObject(mapOf(
    "folder" to JsonPrimitive(folder), "body" to JsonPrimitive(body), "pinned" to JsonPrimitive(pinned),
    "trashed_at" to JsonPrimitive(trashedAt), "share" to JsonPrimitive(share),
    "client_updated" to JsonPrimitive(clientUpdated.ifEmpty { updated }), "device" to JsonPrimitive("android"),
))
internal fun Carpeta.alCable() = JsonObject(mapOf("name" to JsonPrimitive(name), "parent" to JsonPrimitive(parent), "order" to JsonPrimitive(order)))
