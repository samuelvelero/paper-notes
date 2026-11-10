package com.samukis.papernotes.core

import java.text.Normalizer
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Los derivados de un cuerpo: título, texto plano y etiquetas. Es
 * pb_public/js/md.js pasado a Kotlin, regla por regla: el servidor los
 * vuelve a calcular al guardar (los suyos mandan), pero la lista del teléfono
 * los necesita al instante y sin conexión.
 */
object Derive {
    private const val TITLE_MAX = 120
    private val ESC = Regex("\\\\([\\\\`*_{}\\[\\]()#+\\-.!~>|])")
    private val R_HEADING = Regex("^\\s{0,3}#{1,6}\\s+")
    private val R_QUOTE = Regex("^\\s*>\\s?")
    private val R_TODO = Regex("^\\s*(?:[-*+]|\\d+[.)])\\s+\\[[ xX]]\\s*")
    private val R_LIST = Regex("^\\s*(?:[-*+]|\\d+[.)])\\s+")
    private val R_HR = Regex("^\\s*(?:-{3,}|\\*{3,}|_{3,})\\s*$")
    private val R_IMG = Regex("!\\[([^\\]]*)]\\([^)]*\\)")
    private val R_WIKI = Regex("\\[\\[([^\\]\\n|]+?)(?:\\|([^\\]\\n]*))?]]")
    private val R_LINK = Regex("\\[([^\\]]+)]\\([^)]*\\)")
    private val R_STRONG = Regex("(\\*\\*|__|~~|\\+\\+)(\\S(?:[\\s\\S]*?\\S)?)\\1")
    private val R_EM = Regex("(\\*|_)(\\S(?:[\\s\\S]*?\\S)?)\\1")
    private val R_CODE = Regex("`([^`]*)`")
    private val R_FENCE = Regex("^\\s*```")
    private val R_FENCED = Regex("```[\\s\\S]*?(```|$)")
    private val R_CODE_INLINE = Regex("`[^`\\n]*`")
    private val R_TITLE_LINE = Regex("^\\s{0,3}#\\s+\\S")

    private fun norm(md: String?) = (md ?: "").replace("\r\n", "\n").replace('\r', '\n')

    /** Una línea sin marcas de bloque ni inline. */
    fun plainLine(line: String): String {
        /* Un carácter escapado es texto literal: se aparta a un código privado
           para que ninguna regla lo tome por marca, y se restaura al final. */
        var s = ESC.replace(line) { (0xE000 + it.groupValues[1][0].code).toChar().toString() }
        s = R_HEADING.replaceFirst(s, "")
        s = R_QUOTE.replaceFirst(s, "")
        s = R_TODO.replaceFirst(s, "")
        s = R_LIST.replaceFirst(s, "")
        if (R_HR.containsMatchIn(s)) return ""
        s = R_IMG.replace(s) { it.groupValues[1] }
        s = R_WIKI.replace(s) { it.groupValues[2].ifEmpty { it.groupValues[1] } }
        s = R_LINK.replace(s) { it.groupValues[1] }
        s = R_STRONG.replace(s) { it.groupValues[2] }
        s = R_EM.replace(s) { it.groupValues[2] }
        s = R_CODE.replace(s) { it.groupValues[1] }
        val sb = StringBuilder(s.length)
        for (ch in s) sb.append(if (ch in ''..'') (ch.code - 0xE000).toChar() else ch)
        return sb.toString()
    }

    fun plain(md: String?): String {
        val out = ArrayList<String>()
        var inFence = false
        for (line in norm(md).split("\n")) {
            if (R_FENCE.containsMatchIn(line)) { inFence = !inFence; continue }
            out += if (inFence) line else plainLine(line)
        }
        return out.joinToString("\n").replace(Regex("[ \\t]+\\n"), "\n").replace(Regex("\\n{3,}"), "\n\n").trim()
    }

    fun title(md: String?): String {
        var inFence = false
        for (line in norm(md).split("\n")) {
            if (R_FENCE.containsMatchIn(line)) { inFence = !inFence; continue }
            val t = (if (inFence) line else plainLine(line)).trim()
            if (t.isNotEmpty()) return if (t.length > TITLE_MAX) t.substring(0, TITLE_MAX).replace(Regex("\\s+\\S*$"), "") else t
        }
        return ""
    }

    fun tags(md: String?): List<String> {
        val src = R_CODE_INLINE.replace(R_FENCED.replace(norm(md), " "), " ")
        val out = LinkedHashSet<String>()
        for (m in Inline.TAG_RE.findAll(src)) {
            val t = m.groupValues[2].trimEnd('-', '/').lowercase()
            if (t.isNotEmpty()) out += t
        }
        return out.toList()
    }

    /** ¿La nota empieza por una línea con formato Título? */
    fun hasTitle(md: String?): Boolean = R_TITLE_LINE.containsMatchIn(norm(md).split("\n").firstOrNull { it.isNotBlank() } ?: "")

    /** Una nota nueva que se quedó vacía (solo el `# ` del título automático). */
    fun isEmpty(md: String?): Boolean = norm(md).replace(Regex("(?m)^#+\\s*"), "").isBlank()

    private val R_COVER = Regex("!\\[[^\\]]*]\\(attachments/([a-z0-9]{15})\\)")
    /** Primera imagen del cuerpo → portada de la tarjeta. */
    fun cover(md: String?): String? = R_COVER.find(md ?: "")?.groupValues?.get(1)

    /** El cuerpo sin el título, aplanado, para el fragmento de la tarjeta. */
    fun excerpt(title: String, plain: String, max: Int = 110): String {
        var p = plain
        if (title.isNotEmpty() && p.startsWith(title)) p = p.substring(title.length)
        p = p.replace(Regex("\\s*\\n+\\s*"), "  ").replace(Regex("\\s{3,}"), "  ").trim()
        return if (p.length > max) p.substring(0, max).replace(Regex("\\s+\\S*$"), "") + "…" else p
    }

    fun charCount(plain: String) = plain.count { !it.isWhitespace() }
}

/** Texto comparable: minúsculas y sin tildes («diseno» encuentra «diseñar»). */
fun sNorm(s: String?): String =
    Normalizer.normalize((s ?: "").lowercase(), Normalizer.Form.NFD).replace(Regex("[\\u0300-\\u036f]"), "")

object Fechas {
    private val MESES = listOf("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre")

    /** PocketBase escribe "2026-11-10 16:21:05.123Z"; el cliente, ISO con T. */
    fun parse(iso: String?): LocalDateTime? {
        if (iso.isNullOrBlank()) return null
        return runCatching { Instant.parse(iso.trim().replace(' ', 'T')).atZone(ZoneId.systemDefault()).toLocalDateTime() }.getOrNull()
    }
    private val PB = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC)
    /** Ahora, en el formato de fecha de PocketBase ("2026-11-10 16:21:05.123Z"):
     *  así lo local y lo del servidor se comparan y ordenan como texto. */
    fun ahoraPb(): String = PB.format(Instant.now())

    /** "25 de octubre" · con hora si es de hoy ("18:43") · con año si no es este. */
    fun nice(iso: String?, withTime: Boolean = false, now: LocalDateTime = LocalDateTime.now()): String {
        val d = parse(iso) ?: return ""
        val hm = "%02d:%02d".format(d.hour, d.minute)
        if (d.toLocalDate() == now.toLocalDate() && !withTime) return hm
        val y = if (d.year != now.year) " de ${d.year}" else ""
        val base = "${d.dayOfMonth} de ${MESES[d.monthValue - 1]}$y"
        return if (withTime) "$base, $hm" else base
    }
}
