package com.samukis.papernotes.core

/**
 * El formato dentro de una línea: `**negrita**`, `*cursiva*`, `~~tachado~~`,
 * `++subrayado++`, `` `código` ``, `[texto](url)`, `#etiqueta`, `[[enlace]]`
 * y los escapes `\*`. Es el mismo análisis que `inline()` de mdpm.js, pero en
 * vez de un árbol devuelve RANGOS sobre el texto original: qué tramos llevan
 * qué estilo y cuáles son marcas (los `**`, la `\`, el `](url)`). El editor
 * pinta las marcas apagadas en el bloque que se escribe y las esconde en los
 * demás; el texto no se reescribe nunca.
 */
enum class Mark { STRONG, EM, UNDERLINE, STRIKE, CODE, LINK, TAG, WIKILINK }

/** `start..end` (fin excluido) sobre el texto del bloque. */
data class Span(val start: Int, val end: Int, val mark: Mark, val data: String = "")

class InlineParse(val spans: List<Span>, /** Tramos que son sintaxis, no contenido. Ordenados y sin solaparse. */ val markers: List<IntRange>)

object Inline {
    private val DELIMS = listOf("**" to Mark.STRONG, "++" to Mark.UNDERLINE, "~~" to Mark.STRIKE, "*" to Mark.EM, "_" to Mark.EM)
    private const val PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
    private fun punct(c: Char) = c.isWhitespace() || PUNCT.indexOf(c) >= 0
    private val LINK = Regex("^\\[([^\\]\\n]*)]\\(([^)\\s]+)\\)")
    val TAG_RE = Regex("(^|[\\s(\\[])#([A-Za-z_À-ɏ][\\w\\-/À-ɏ]{0,59})")
    val WIKILINK_RE = Regex("\\[\\[([^\\]\\n|]+?)(?:\\|[^\\]\\n]*)?]]")

    fun parse(text: String): InlineParse {
        val spans = ArrayList<Span>()
        val markers = ArrayList<IntRange>()
        val code = ArrayList<IntRange>()
        var base = 0
        for (line in text.split("\n")) {
            walk(line, base, emptySet(), spans, markers, code)
            base += line.length + 1
        }
        /* #etiqueta y [[enlace]]: texto decorado, fuera del código. */
        fun inCode(i: Int) = code.any { i in it }
        for (m in TAG_RE.findAll(text)) {
            val from = m.range.first + m.groupValues[1].length
            if (!inCode(from)) spans += Span(from, m.range.last + 1, Mark.TAG, m.groupValues[2].trimEnd('-', '/').lowercase())
        }
        for (m in WIKILINK_RE.findAll(text)) {
            if (!inCode(m.range.first)) spans += Span(m.range.first, m.range.last + 1, Mark.WIKILINK, m.groupValues[1].trim())
        }
        markers.sortBy { it.first }
        return InlineParse(spans, markers)
    }

    private fun walk(s: String, base: Int, marks: Set<Mark>, spans: MutableList<Span>, markers: MutableList<IntRange>, code: MutableList<IntRange>) {
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '\\' && i + 1 < s.length && punct(s[i + 1])) { markers += (base + i)..(base + i); i += 2; continue }
            if (c == '`') {
                var run = 1
                while (i + run < s.length && s[i + run] == '`') run++
                val close = s.indexOf("`".repeat(run), i + run)
                if (close > i + run) {
                    markers += (base + i) until (base + i + run)
                    markers += (base + close) until (base + close + run)
                    spans += Span(base + i + run, base + close, Mark.CODE)
                    code += (base + i) until (base + close + run)
                    i = close + run; continue
                }
                i += run; continue
            }
            if (c == '[' && (i + 1 >= s.length || s[i + 1] != '[')) {
                val m = LINK.find(s.substring(i))
                if (m != null) {
                    val inner = m.groupValues[1]
                    markers += (base + i)..(base + i)
                    markers += (base + i + 1 + inner.length) until (base + i + m.value.length)
                    spans += Span(base + i + 1, base + i + 1 + inner.length, Mark.LINK, m.groupValues[2])
                    walk(inner, base + i + 1, marks + Mark.LINK, spans, markers, code)
                    i += m.value.length; continue
                }
            }
            var hit = false
            for ((d, mark) in DELIMS) {
                if (!s.startsWith(d, i) || mark in marks) continue
                /* `_` y `*` abren solo al principio o tras espacio/puntuación:
                   "a*b*c" y "snake_case" son texto. */
                if (d.length == 1 && i > 0 && !punct(s[i - 1])) continue
                val next = s.getOrNull(i + d.length) ?: continue
                if (next.isWhitespace() || (d.length == 1 && next == d[0])) continue
                val close = findClose(s, i + d.length, d)
                if (close < 0) continue
                markers += (base + i) until (base + i + d.length)
                markers += (base + close) until (base + close + d.length)
                spans += Span(base + i + d.length, base + close, mark)
                walk(s.substring(i + d.length, close), base + i + d.length, marks + mark, spans, markers, code)
                i = close + d.length
                hit = true
                break
            }
            if (!hit) i++
        }
    }

    /* Cierre del delimitador: el mismo texto, no precedido por espacio ni por
       barra, y para `_` no seguido de letra. Salta los tramos de código. */
    private fun findClose(s: String, from: Int, d: String): Int {
        var i = from
        while (i < s.length) {
            if (s[i] == '\\') { i += 2; continue }
            if (s[i] == '`') { val j = s.indexOf('`', i + 1); if (j < 0) return -1; i = j + 1; continue }
            if (s.startsWith(d, i) && !s[i - 1].isWhitespace() && (d != "_" || i + 1 >= s.length || punct(s[i + 1])) &&
                (d.length == 2 || s.getOrNull(i + 1) != d[0])) return i
            i++
        }
        return -1
    }
}
