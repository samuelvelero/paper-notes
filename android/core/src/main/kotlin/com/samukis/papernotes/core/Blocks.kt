package com.samukis.papernotes.core

/**
 * Markdown ↔ bloques del editor. Es el MISMO dialecto que la web
 * (pb_public/js/mdpm.js), con otra forma por dentro: la web edita un árbol de
 * ProseMirror; aquí el editor es una lista PLANA de bloques con `depth`
 * (la sangría de lista), que es lo que un LazyColumn pinta bien.
 *
 * El contrato que protege a las notas: para el Markdown que escribe la web
 * (su forma canónica), `serialize(parse(md)) == md`. Abrir una nota en el
 * teléfono y tocar una letra no reordena ni «normaliza» el resto. Lo
 * comprueban los casos de oro (android/scripts/oro-md.js → BlocksTest).
 *
 * El texto de un bloque es Markdown INLINE tal cual (con sus `**`, sus `\*`):
 * el editor lo pinta con estilo, pero no lo reescribe.
 */
enum class Kind { PARAGRAPH, H1, H2, H3, BULLET, ORDERED, TODO, QUOTE, CODE, HR, IMAGE }

val Kind.isList get() = this == Kind.BULLET || this == Kind.ORDERED || this == Kind.TODO
val Kind.isHeading get() = this == Kind.H1 || this == Kind.H2 || this == Kind.H3
/** Bloques con texto que se escribe. */
val Kind.hasText get() = this != Kind.HR && this != Kind.IMAGE

data class Block(
    val kind: Kind,
    /** Markdown inline. En QUOTE y CODE, varias líneas tal cual. */
    val text: String = "",
    /** Nivel de lista: un elemento a `depth` es hijo del elemento anterior con
     *  depth menor. Un bloque que no es de lista con depth > 0 es un bloque
     *  más dentro de ese elemento (su segundo párrafo, una imagen…). */
    val depth: Int = 0,
    val checked: Boolean = false,
    /** ORDERED: el número con el que empieza su lista (solo cuenta el del primero). */
    val start: Int = 1,
    val lang: String = "",
    val src: String = "",
    val alt: String = "",
)

object Markdown {
    private val HEADING = Regex("^ {0,3}(#{1,6})\\s+(.*)$")
    private val HR = Regex("^ {0,3}(?:-{3,}|\\*{3,}|_{3,})\\s*$")
    private val FENCE = Regex("^ {0,3}```(.*)$")
    private val FENCE_END = Regex("^ {0,3}```\\s*$")
    private val QUOTE = Regex("^ {0,3}>\\s?(.*)$")
    private val TODO = Regex("^( *)[-*+] \\[([ xX])]\\s?(.*)$")
    private val BULLET = Regex("^( *)[-*+] (.*)$")
    private val BULLET_EMPTY = Regex("^( *)[-*+]\\s*$")
    private val ORDERED = Regex("^( *)(\\d{1,9})[.)] (.*)$")
    private val IMAGE = Regex("^ {0,3}!\\[([^\\]]*)]\\(([^)\\s]+)\\)\\s*$")
    private val TRAILING_HASHES = Regex("\\s+#+\\s*$")

    /** Lo que un párrafo NO puede parecer al principio: se escapa con `\`. */
    private val BLOCKISH = listOf(
        Regex("^ {0,3}#{1,6}\\s"), Regex("^ {0,3}(?:[-*+]|\\d{1,9}[.)])\\s"), Regex("^ {0,3}>"),
        Regex("^ {0,3}```"), Regex("^ {0,3}(?:-{3,}|\\*{3,}|_{3,})\\s*$"), Regex("^ {0,3}!\\["),
    )

    private fun blank(l: String) = l.all { it.isWhitespace() || it == ' ' || it == '﻿' }
    private fun String.jsTrim() = trim { it.isWhitespace() || it == ' ' || it == '﻿' }
    private fun indentOf(l: String): Int { var n = 0; while (n < l.length && l[n] == ' ') n++; return n }
    private fun startsBlock(l: String) = HEADING.containsMatchIn(l) || HR.containsMatchIn(l) || FENCE.containsMatchIn(l) ||
        QUOTE.containsMatchIn(l) || TODO.containsMatchIn(l) || BULLET.containsMatchIn(l) || ORDERED.containsMatchIn(l) || IMAGE.containsMatchIn(l)

    // ─────────────── Markdown → bloques ───────────────

    fun parse(md: String?): List<Block> {
        val lines = (md ?: "").replace("\r\n", "\n").replace('\r', '\n').split("\n")
        val out = parseBlocks(lines, 0)
        return out.ifEmpty { listOf(Block(Kind.PARAGRAPH)) }
    }

    /* Líneas en blanco de más = párrafos vacíos (la separación que el usuario
       dejó con Enter): entre dos bloques la separación normal es UNA y cada
       párrafo vacío suma dos, k = (L-1)/2; al principio y al final, k = L/2. */
    private fun parseBlocks(lines: List<String>, depth: Int): MutableList<Block> {
        val out = ArrayList<Block>()
        var i = 0
        var blanks = 0
        fun empties(n: Int) { repeat(n) { out += Block(Kind.PARAGRAPH, depth = depth) } }
        while (i < lines.size) {
            val line = lines[i]
            if (blank(line)) { blanks++; i++; continue }
            if (blanks > 0) { empties(if (out.isNotEmpty()) (blanks - 1) / 2 else blanks / 2); blanks = 0 }
            val fence = FENCE.find(line)
            if (fence != null) {
                val buf = ArrayList<String>()
                i++
                while (i < lines.size && !FENCE_END.containsMatchIn(lines[i])) buf += lines[i++]
                i++   // la valla de cierre (o el final)
                out += Block(Kind.CODE, buf.joinToString("\n"), depth, lang = fence.groupValues[1].jsTrim())
                continue
            }
            val h = HEADING.find(line)
            if (h != null) {
                val kind = when (minOf(h.groupValues[1].length, 3)) { 1 -> Kind.H1; 2 -> Kind.H2; else -> Kind.H3 }
                out += Block(kind, h.groupValues[2].replace(TRAILING_HASHES, "").jsTrim(), depth)
                i++; continue
            }
            if (HR.containsMatchIn(line)) { out += Block(Kind.HR, depth = depth); i++; continue }
            val img = IMAGE.find(line)
            if (img != null) { out += Block(Kind.IMAGE, depth = depth, src = img.groupValues[2], alt = img.groupValues[1]); i++; continue }
            if (QUOTE.containsMatchIn(line)) {
                val inner = ArrayList<String>()
                while (i < lines.size && QUOTE.containsMatchIn(lines[i])) inner += QUOTE.find(lines[i++])!!.groupValues[1]
                out += Block(Kind.QUOTE, inner.joinToString("\n"), depth)
                continue
            }
            if (TODO.containsMatchIn(line) || BULLET.containsMatchIn(line) || ORDERED.containsMatchIn(line) || BULLET_EMPTY.containsMatchIn(line)) {
                i = parseList(lines, i, depth, out)
                continue
            }
            /* Párrafo: hasta línea en blanco o hasta que empiece otro bloque. */
            val buf = arrayListOf(line)
            i++
            while (i < lines.size && !blank(lines[i]) && !startsBlock(lines[i])) buf += lines[i++]
            out += Block(Kind.PARAGRAPH, buf.joinToString("\n") { it.jsTrim() }, depth)
        }
        if (blanks > 0 && out.isNotEmpty()) empties(blanks / 2)
        return out
    }

    /* Una lista: elementos del mismo tipo y sangría. Cada elemento se lleva sus
       líneas de continuación (sangradas), que se analizan un nivel más adentro. */
    private fun parseList(lines: List<String>, start: Int, depth: Int, out: MutableList<Block>): Int {
        val first = lines[start]
        val kind = if (TODO.containsMatchIn(first)) Kind.TODO else if (ORDERED.containsMatchIn(first)) Kind.ORDERED else Kind.BULLET
        val indent = indentOf(first)
        var i = start
        var order = 1
        var items = 0
        fun sameKind(l: String) = when (kind) {
            Kind.TODO -> TODO.containsMatchIn(l)
            Kind.ORDERED -> ORDERED.containsMatchIn(l)
            else -> BULLET.containsMatchIn(l) && !TODO.containsMatchIn(l)
        }
        while (i < lines.size) {
            val l = lines[i]
            if (indentOf(l) != indent) break
            var head: String
            var checked = false
            val mt = if (kind == Kind.TODO) TODO.find(l) else null
            val mo = if (kind == Kind.ORDERED) ORDERED.find(l) else null
            val mb = if (kind == Kind.BULLET && !TODO.containsMatchIn(l)) BULLET.find(l) else null
            when {
                mt != null -> { checked = mt.groupValues[2] != " "; head = mt.groupValues[3] }
                mo != null -> { if (items == 0) order = mo.groupValues[2].toIntOrNull() ?: 1; head = mo.groupValues[3] }
                mb != null -> head = mb.groupValues[2]
                kind == Kind.BULLET && BULLET_EMPTY.containsMatchIn(l) -> head = ""
                else -> break
            }
            val markerW = if (kind == Kind.ORDERED) 3 else 2
            val sub = arrayListOf(head)
            i++
            /* Continuación: líneas con más sangría, y líneas en blanco si después
               sigue algo sangrado (otro bloque del mismo elemento). */
            while (i < lines.size) {
                val n = lines[i]
                val nind = indentOf(n)
                if (blank(n)) {
                    var j = i + 1
                    while (j < lines.size && blank(lines[j])) j++
                    val after = if (j < lines.size) indentOf(lines[j]) else -1
                    if (after > indent) { sub += ""; i++; continue }
                    break
                }
                if (nind > indent) { sub += n.substring(minOf(nind, indent + markerW)); i++; continue }
                break
            }
            val content = parseBlocks(sub, depth + 1)
            val text = if (content.isNotEmpty() && content[0].kind == Kind.PARAGRAPH) content.removeAt(0).text else ""
            out += Block(kind, text, depth, checked = checked, start = order)
            out += content
            items++
            /* Elementos separados por UNA línea en blanco siguen siendo la misma lista. */
            if (i < lines.size && blank(lines[i]) && i + 1 < lines.size && indentOf(lines[i + 1]) == indent && sameKind(lines[i + 1])) i++
        }
        return i
    }

    // ─────────────── bloques → Markdown ───────────────

    private class Piece(val text: String, val isList: Boolean)

    fun serialize(blocks: List<Block>): String {
        if (blocks.size == 1 && blocks[0].kind == Kind.PARAGRAPH && blocks[0].text.isEmpty()) return ""
        return pieces(blocks, 0, blocks.size, top = true).joinToString("\n\n") { it.text }
    }

    private fun escapeBlock(t: String) = if (BLOCKISH.any { it.containsMatchIn(t) }) "\\" + t.trimStart(' ') else t

    private fun blockText(b: Block): String = when (b.kind) {
        Kind.PARAGRAPH -> escapeBlock(b.text)
        Kind.H1 -> "# " + b.text.replace('\n', ' ')
        Kind.H2 -> "## " + b.text.replace('\n', ' ')
        Kind.H3 -> "### " + b.text.replace('\n', ' ')
        Kind.QUOTE -> b.text.split("\n").joinToString("\n") { if (it.isNotEmpty()) "> $it" else ">" }
        Kind.CODE -> "```" + b.lang + "\n" + b.text + "\n```"
        Kind.HR -> "---"
        Kind.IMAGE -> "![${b.alt.replace("[", "").replace("]", "")}](${b.src})"
        else -> b.text
    }

    /** Los trozos que se unen con línea en blanco entre `from` y `to`. Una
     *  lista entera (con todo lo que cuelga de sus elementos) es UN trozo. */
    private fun pieces(list: List<Block>, from: Int, to: Int, top: Boolean): List<Piece> {
        val out = ArrayList<Piece>()
        var i = from
        while (i < to) {
            val b = list[i]
            if (b.kind.isList) {
                val kind = b.kind
                val depth = b.depth
                var k = b.start
                val items = ArrayList<String>()
                while (i < to && list[i].kind == kind && list[i].depth <= depth) {
                    val it = list[i]
                    i++
                    var j = i
                    while (j < to && list[j].depth > depth) j++
                    val marker = when (kind) {
                        Kind.TODO -> if (it.checked) "- [x] " else "- [ ] "
                        Kind.ORDERED -> "${k++}. "
                        else -> "- "
                    }
                    val pad = if (kind == Kind.ORDERED) "   " else "  "
                    val sb = StringBuilder(marker).append(escapeBlock(it.text).replace("\n", "\n" + pad))
                    /* una lista anidada va pegada a su párrafo; otro bloque, con línea en blanco */
                    for (p in pieces(list, i, j, top = false)) {
                        sb.append(if (p.isList) "\n" else "\n\n")
                        sb.append(p.text.split("\n").joinToString("\n") { l -> if (l.isNotEmpty()) pad + l else l })
                    }
                    items += sb.toString()
                    i = j
                }
                out += Piece(items.joinToString("\n"), true)
                continue
            }
            i++
            if (b.kind != Kind.PARAGRAPH || !top) { out += Piece(blockText(b), false); continue }
            /* Un párrafo vacío sale como cadena vacía (al unir suma dos líneas en
               blanco). Los saltos al principio o al final de un párrafo, o dos
               seguidos en medio, se ven como líneas vacías y se guardan igual. */
            val t = b.text
            var lead = 0; while (lead < t.length && t[lead] == '\n') lead++
            if (lead == t.length) { repeat(maxOf(1, t.length)) { out += Piece("", false) }; continue }
            var trail = 0; while (t[t.length - 1 - trail] == '\n') trail++
            repeat(lead) { out += Piece("", false) }
            val core = t.substring(lead, t.length - trail)
            var p = 0
            for (m in MULTI_NL.findAll(core)) {
                out += Piece(escapeBlock(core.substring(p, m.range.first)), false)
                repeat(m.value.length - 1) { out += Piece("", false) }
                p = m.range.last + 1
            }
            out += Piece(escapeBlock(core.substring(p)), false)
            repeat(trail) { out += Piece("", false) }
        }
        return out
    }
    private val MULTI_NL = Regex("\n{2,}")
}
