package com.samukis.papernotes.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Los casos de oro salen de la web (android/scripts/oro-md.js). */
class BlocksTest {
    private val casos = Json.parseToJsonElement(
        javaClass.getResource("/golden/md.json")!!.readText(Charsets.UTF_8)
    ).jsonArray.map { it.jsonObject }

    private fun s(o: kotlinx.serialization.json.JsonObject, k: String) = o[k]!!.jsonPrimitive.content

    @Test fun `la forma canonica de la web va y vuelve igual`() {
        for (c in casos) {
            val canon = s(c, "canon")
            assertEquals(canon, Markdown.serialize(Markdown.parse(canon)), "canon: ${canon.replace("\n", "⏎")}")
        }
    }

    @Test fun `lo que no es canonico acaba en una forma estable`() {
        for (c in casos) {
            val una = Markdown.serialize(Markdown.parse(s(c, "md")))
            assertEquals(una, Markdown.serialize(Markdown.parse(una)), "md: ${s(c, "md").replace("\n", "⏎")}")
        }
    }

    @Test fun `titulo, texto plano y etiquetas como md_js`() {
        for (c in casos) {
            val canon = s(c, "canon")
            assertEquals(s(c, "title"), Derive.title(canon), "title de: $canon")
            assertEquals(s(c, "plain"), Derive.plain(canon), "plain de: $canon")
            assertEquals(c["tags"]!!.jsonArray.map { it.jsonPrimitive.content }, Derive.tags(canon), "tags de: $canon")
            assertEquals(c["hasTitle"]!!.jsonPrimitive.content == "true", Derive.hasTitle(canon), "hasTitle de: $canon")
        }
    }

    @Test fun `estructura plana con profundidad`() {
        val b = Markdown.parse("- [x] a\n  - b\n\n  párrafo dentro\n- [ ] c\n\nfuera")
        assertEquals(listOf(Kind.TODO, Kind.BULLET, Kind.PARAGRAPH, Kind.TODO, Kind.PARAGRAPH), b.map { it.kind })
        assertEquals(listOf(0, 1, 1, 0, 0), b.map { it.depth })
        assertTrue(b[0].checked && !b[3].checked)
    }

    @Test fun `marcas inline como rangos`() {
        val t = "a **b** `c*d*` [e](http://x) #tag \\*f"
        val p = Inline.parse(t)
        fun de(m: Mark) = p.spans.filter { it.mark == m }.map { t.substring(it.start, it.end) }
        assertEquals(listOf("b"), de(Mark.STRONG))
        assertEquals(listOf("c*d*"), de(Mark.CODE))
        assertEquals(listOf("e"), de(Mark.LINK))
        assertEquals(listOf("#tag"), de(Mark.TAG))
        assertEquals(emptyList(), de(Mark.EM))
        val sinMarcas = buildString { t.forEachIndexed { i, ch -> if (p.markers.none { i in it }) append(ch) } }
        assertEquals("a b c*d* e #tag *f", sinMarcas)
    }
}
