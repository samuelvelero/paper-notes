package com.samukis.papernotes.ui.editor

import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import com.samukis.papernotes.core.Block
import com.samukis.papernotes.core.Kind
import com.samukis.papernotes.core.Markdown
import com.samukis.papernotes.core.hasText
import com.samukis.papernotes.core.isHeading
import com.samukis.papernotes.core.isList

/** Un bloque del editor: lo de `core.Block`, pero vivo (estado de Compose). */
class Bloque(val id: Long, b: Block) {
    var kind by mutableStateOf(b.kind)
    var valor by mutableStateOf(TextFieldValue(b.text))
    var depth by mutableIntStateOf(b.depth)
    var checked by mutableStateOf(b.checked)
    var start = b.start
    var lang = b.lang
    val src = b.src
    val alt = b.alt
    val foco = FocusRequester()
    val texto get() = valor.text
    fun aBlock() = Block(kind, valor.text, depth, checked, start, lang, src, alt)
}

/**
 * El editor: una lista de bloques y TODO lo que se puede hacer con ellos.
 * Los composables solo pintan y avisan (`alCambiar`, `retroceso`, `orden`).
 *
 * Cómo se escribe:
 *  - Cada bloque de texto es su propio campo. Enter parte el bloque; Retroceso
 *    al principio lo «baja» (lista → párrafo) o lo une con el de arriba.
 *  - El formato de BLOQUE no está en el texto: `# `, `- `, `[] `, `1. `, `> `
 *    al principio de un párrafo lo convierten, igual que en la web.
 *  - El formato INLINE sí es texto (`**así**`): se ve con estilo, con las
 *    marcas apagadas en el bloque que se escribe y escondidas en los demás.
 */
class Editor(md: String) {
    val bloques = mutableStateListOf<Bloque>()
    var enfocado by mutableStateOf<Long?>(null)
    /** Sube con cada cambio de contenido: lo vigila el autoguardado. */
    var cambios by mutableIntStateOf(0); private set
    /** (id, posición): el bloque lo recoge en cuanto está compuesto. */
    var focoPendiente by mutableStateOf<Pair<Long, Int>?>(null)
    private var sig = 1L

    private class Foto(val md: String, val indice: Int, val pos: Int)
    private val pasado = ArrayDeque<Foto>()
    private val futuro = ArrayDeque<Foto>()
    private var ultimaFoto = 0L
    var puedeDeshacer by mutableStateOf(false); private set
    var puedeRehacer by mutableStateOf(false); private set

    init { cargar(md) }

    fun cargar(md: String) {
        bloques.clear()
        bloques.addAll(Markdown.parse(md).map { Bloque(sig++, it) })
    }
    fun markdown(): String = Markdown.serialize(bloques.map { it.aBlock() })
    fun actual(): Bloque? = bloques.firstOrNull { it.id == enfocado }
    private fun nuevo(b: Block) = Bloque(sig++, b)
    fun pedirFoco(b: Bloque, pos: Int) { focoPendiente = b.id to pos }

    /** El número de cada elemento de lista numerada (id → n). */
    val numeros by derivedStateOf {
        val out = HashMap<Long, Int>()
        val cuenta = HashMap<Int, Int>()
        for (b in bloques) {
            val d = b.depth
            cuenta.keys.removeAll { it > d }
            if (b.kind == Kind.ORDERED) { val n = cuenta[d]?.plus(1) ?: b.start; cuenta[d] = n; out[b.id] = n }
            else if (b.kind.isList || d == 0) cuenta.remove(d)
        }
        out
    }

    // ─────────────── deshacer ───────────────

    private fun fotoActual(): Foto {
        val b = actual()
        return Foto(markdown(), if (b == null) -1 else bloques.indexOf(b), b?.valor?.selection?.start ?: 0)
    }
    /** Antes de cambiar algo. Lo que se teclea seguido cae en un solo paso. */
    private fun foto(estructural: Boolean) {
        val ahora = System.currentTimeMillis()
        if (!estructural && ahora - ultimaFoto < 1200) { ultimaFoto = ahora; return }
        ultimaFoto = ahora
        val f = fotoActual()
        if (pasado.lastOrNull()?.md == f.md) return
        pasado.addLast(f)
        if (pasado.size > 100) pasado.removeFirst()
        futuro.clear()
        puedeDeshacer = true; puedeRehacer = false
    }
    private fun restaurar(f: Foto) {
        cargar(f.md)
        bloques.getOrNull(f.indice)?.let { pedirFoco(it, f.pos) }
        ultimaFoto = 0
        cambios++
        puedeDeshacer = pasado.isNotEmpty(); puedeRehacer = futuro.isNotEmpty()
    }
    fun deshacer() { val f = pasado.removeLastOrNull() ?: return; futuro.addLast(fotoActual()); restaurar(f) }
    fun rehacer() { val f = futuro.removeLastOrNull() ?: return; pasado.addLast(fotoActual()); restaurar(f) }

    // ─────────────── escribir ───────────────

    fun alCambiar(b: Bloque, nv: TextFieldValue) {
        val a = b.valor.text
        val n = nv.text
        if (n == a) { b.valor = nv; return }   // solo se movió el cursor o la composición
        /* Qué se insertó: lo que queda entre el prefijo y el sufijo comunes. */
        val max = minOf(a.length, n.length)
        var p = 0
        while (p < max && a[p] == n[p]) p++
        var s = 0
        while (s < max - p && a[a.length - 1 - s] == n[n.length - 1 - s]) s++
        val dentro = n.substring(p, n.length - s)
        val salto = '\n' in dentro
        foto(estructural = salto)
        if (salto && b.kind != Kind.CODE && b.kind != Kind.QUOTE) {
            val antes = n.substring(0, p)
            val despues = n.substring(n.length - s)
            /* Un solo salto es la tecla Enter, aunque llegue junto con la palabra
               que el teclado acaba de autocorregir («leche⏎» → «Leche⏎»): lo
               que cambió antes del salto se queda en este bloque. */
            if (dentro.count { it == '\n' } == 1) partir(b, antes + dentro.substringBefore('\n'), dentro.substringAfter('\n') + despues)
            else pegar(b, antes, dentro, despues)
            cambios++
            return
        }
        if (salto && dentro == "\n" && s == 0 && (b.kind == Kind.QUOTE || a.isNotEmpty()) && (a.isEmpty() || a.endsWith("\n"))) {
            /* Enter sobre una línea vacía al final de una cita o de un bloque
               de código: sale del bloque. */
            val i = bloques.indexOf(b)
            if (a.isEmpty()) { b.kind = Kind.PARAGRAPH; b.valor = TextFieldValue("") }
            else {
                b.valor = TextFieldValue(a.dropLast(1))
                val q = nuevo(Block(Kind.PARAGRAPH, depth = b.depth))
                bloques.add(i + 1, q); pedirFoco(q, 0)
            }
            cambios++
            return
        }
        b.valor = nv
        val fin = p + dentro.length
        if (dentro.endsWith(" ") && nv.selection.collapsed && nv.selection.start == fin) reglas(b, n.substring(0, fin), n.substring(fin))
        cambios++
    }

    private val R_ORDEN = Regex("^(\\d{1,9})[.)] $")
    private val R_VALLA = Regex("^```(\\w*)$")

    /** Las reglas de entrada: Markdown al principio de un párrafo → su bloque. */
    private fun reglas(b: Bloque, cabeza: String, resto: String) {
        fun a(kind: Kind, hecho: Boolean = false, inicio: Int = 1) {
            b.kind = kind; b.checked = hecho; b.start = inicio
            if (kind.isHeading) b.depth = 0
            b.valor = TextFieldValue(resto, TextRange(0))
        }
        if (b.kind == Kind.BULLET) {
            when (cabeza) { "[] ", "[ ] " -> a(Kind.TODO); "[x] ", "[X] " -> a(Kind.TODO, hecho = true) }
            return
        }
        if (b.kind != Kind.PARAGRAPH) return
        when (cabeza) {
            "# " -> a(Kind.H1); "## " -> a(Kind.H2); "### " -> a(Kind.H3)
            "- ", "* ", "+ " -> a(Kind.BULLET)
            "[] ", "[ ] " -> a(Kind.TODO); "[x] ", "[X] " -> a(Kind.TODO, hecho = true)
            "> " -> a(Kind.QUOTE)
            else -> R_ORDEN.find(cabeza)?.let { a(Kind.ORDERED, inicio = it.groupValues[1].toIntOrNull() ?: 1) }
        }
    }

    /** Enter en mitad (o al final) de un bloque. */
    private fun partir(b: Bloque, antes: String, despues: String) {
        val i = bloques.indexOf(b)
        val valla = if (b.kind == Kind.PARAGRAPH && despues.isEmpty()) R_VALLA.find(antes) else null
        when {
            valla != null -> { b.kind = Kind.CODE; b.lang = valla.groupValues[1]; b.valor = TextFieldValue("") }
            b.kind == Kind.PARAGRAPH && despues.isEmpty() && (antes == "---" || antes == "***" || antes == "___") -> {
                b.kind = Kind.HR; b.valor = TextFieldValue("")
                val q = nuevo(Block(Kind.PARAGRAPH)); bloques.add(i + 1, q); pedirFoco(q, 0)
            }
            /* Enter en un elemento vacío: sale de la lista (o sube un nivel). */
            b.kind.isList && antes.isEmpty() && despues.isEmpty() -> {
                if (b.depth > 0) b.depth-- else b.kind = Kind.PARAGRAPH
                b.valor = TextFieldValue("")
            }
            b.kind.isHeading && antes.isEmpty() -> {
                bloques.add(i, nuevo(Block(Kind.PARAGRAPH)))
                b.valor = TextFieldValue(despues, TextRange(0))
            }
            else -> {
                b.valor = TextFieldValue(antes)
                val q = nuevo(Block(if (b.kind.isList) b.kind else Kind.PARAGRAPH, despues, b.depth, start = b.start))
                bloques.add(i + 1, q); pedirFoco(q, 0)
            }
        }
    }

    /** Se pegó texto de varias líneas: cada línea es su bloque (y si trae
     *  Markdown, se interpreta). */
    private fun pegar(b: Bloque, antes: String, dentro: String, despues: String) {
        val i = bloques.indexOf(b)
        val nuevos = (if ("```" in dentro) Markdown.parse(dentro) else dentro.split("\n").filter { it.isNotBlank() }.flatMap { Markdown.parse(it) }).toMutableList()
        if (nuevos.isEmpty()) { b.valor = TextFieldValue(antes + despues, TextRange(antes.length)); return }
        val primero = nuevos[0]
        when {
            primero.kind == Kind.PARAGRAPH -> { b.valor = TextFieldValue(antes + primero.text); nuevos.removeAt(0) }
            antes.isEmpty() && b.kind == Kind.PARAGRAPH && primero.kind.hasText -> {
                b.kind = primero.kind; b.checked = primero.checked; b.start = primero.start; b.lang = primero.lang
                b.valor = TextFieldValue(primero.text); nuevos.removeAt(0)
            }
            else -> b.valor = TextFieldValue(antes)
        }
        val vivos = nuevos.map { nuevo(it) }
        bloques.addAll(i + 1, vivos)
        val ultimo = vivos.lastOrNull() ?: b
        if (ultimo.kind.hasText) {
            val corte = ultimo.texto.length
            ultimo.valor = TextFieldValue(ultimo.texto + despues)
            pedirFoco(ultimo, corte)
        } else {
            val q = nuevo(Block(Kind.PARAGRAPH, despues))
            bloques.add(bloques.indexOf(ultimo) + 1, q); pedirFoco(q, 0)
        }
    }

    /** Retroceso con el cursor al principio. true = lo resolvió el editor. */
    fun retroceso(b: Bloque): Boolean {
        val i = bloques.indexOf(b)
        if (i < 0) return false
        when {
            b.kind.isList -> { foto(true); if (b.depth > 0) b.depth-- else b.kind = Kind.PARAGRAPH }
            b.kind != Kind.PARAGRAPH -> { foto(true); b.kind = Kind.PARAGRAPH }
            b.depth > 0 -> { foto(true); b.depth-- }
            i == 0 -> return false
            else -> {
                foto(true)
                val arriba = bloques[i - 1]
                if (!arriba.kind.hasText) bloques.removeAt(i - 1)   // un separador o una imagen: se va
                else {
                    val corte = arriba.texto.length
                    arriba.valor = TextFieldValue(arriba.texto + b.texto, TextRange(corte))
                    bloques.removeAt(i)
                    pedirFoco(arriba, corte)
                }
            }
        }
        cambios++
        return true
    }

    // ─────────────── la barra ───────────────

    /** Cambia el tipo del bloque con el cursor; repetir el mismo lo devuelve a párrafo. */
    fun tipo(k: Kind) {
        val b = actual() ?: return
        foto(true)
        if (b.kind == k) b.kind = Kind.PARAGRAPH
        else {
            b.kind = k
            if (k == Kind.TODO) b.checked = false
            if (k == Kind.ORDERED) b.start = 1
            if (k == Kind.CODE) b.lang = ""
            if (!k.isList) b.depth = 0
        }
        cambios++
    }

    /** Envuelve la selección en una marca inline (`**`, `*`, `++`, `~~`, `` ` ``), o la quita. */
    fun marca(m: String) {
        val b = actual() ?: return
        if (b.kind == Kind.CODE) return
        foto(true)
        val v = b.valor
        val t = v.text
        val a = v.selection.min
        val z = v.selection.max
        b.valor = when {
            a == z && t.startsWith(m, a) -> v.copy(selection = TextRange(a + m.length))   // ya está dentro: sale de la marca
            a == z -> TextFieldValue(t.substring(0, a) + m + m + t.substring(a), TextRange(a + m.length))
            a >= m.length && t.startsWith(m, a - m.length) && t.startsWith(m, z) ->
                TextFieldValue(t.substring(0, a - m.length) + t.substring(a, z) + t.substring(z + m.length), TextRange(a - m.length, z - m.length))
            else -> TextFieldValue(t.substring(0, a) + m + t.substring(a, z) + m + t.substring(z), TextRange(a + m.length, z + m.length))
        }
        cambios++
    }

    fun puedeSangrar(b: Bloque?, delta: Int): Boolean {
        if (b == null || !b.kind.isList) return false
        if (delta < 0) return b.depth > 0
        val arriba = bloques.getOrNull(bloques.indexOf(b) - 1) ?: return false
        return (arriba.kind.isList || arriba.depth > 0) && b.depth <= arriba.depth
    }
    fun sangria(delta: Int) {
        val b = actual() ?: return
        if (!puedeSangrar(b, delta)) return
        foto(true); b.depth += delta; cambios++
    }

    fun separador() {
        val b = actual()
        foto(true)
        val i = if (b == null) bloques.size else bloques.indexOf(b) + 1
        bloques.add(i, nuevo(Block(Kind.HR)))
        val q = bloques.getOrNull(i + 1)?.takeIf { it.kind.hasText } ?: nuevo(Block(Kind.PARAGRAPH)).also { bloques.add(i + 1, it) }
        pedirFoco(q, 0)
        cambios++
    }

    /** Inserta una imagen ya subida bajo el bloque `tras` (o al final). */
    fun imagen(src: String, tras: Long?) {
        foto(true)
        val b = bloques.firstOrNull { it.id == tras }
        var i = if (b == null) bloques.size else bloques.indexOf(b) + 1
        /* un párrafo vacío con el cursor se sustituye por la imagen */
        if (b != null && b.kind == Kind.PARAGRAPH && b.texto.isEmpty() && bloques.size > 1) { i--; bloques.removeAt(i) }
        bloques.add(i, nuevo(Block(Kind.IMAGE, src = src)))
        if (i == bloques.lastIndex) bloques.add(nuevo(Block(Kind.PARAGRAPH)))
        cambios++
    }

    fun casilla(b: Bloque) { foto(true); b.checked = !b.checked; cambios++ }

    fun quitar(b: Bloque) {
        foto(true)
        bloques.remove(b)
        if (bloques.isEmpty()) bloques.add(nuevo(Block(Kind.PARAGRAPH)))
        cambios++
    }

    /** Tocar el hueco de debajo: el cursor al final, creando un párrafo si lo
     *  último no se puede escribir (una imagen, un separador, código…). */
    fun focoAlFinal() {
        val u = bloques.lastOrNull()
        if (u != null && (u.kind == Kind.PARAGRAPH || u.kind.isHeading || (u.kind.isList && u.texto.isEmpty()))) { pedirFoco(u, u.texto.length); return }
        val q = nuevo(Block(Kind.PARAGRAPH))
        bloques.add(q); pedirFoco(q, 0)
    }
}
