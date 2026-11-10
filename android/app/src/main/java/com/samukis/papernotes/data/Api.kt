package com.samukis.papernotes.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder

/**
 * El error de una petición. `status` 0 = no hubo respuesta (sin red, tiempo
 * agotado): es la única clase de error en la que no tiene sentido seguir
 * probando el resto de la cola.
 */
class ErrorApi(val status: Int, mensaje: String) : IOException(mensaje)

/** Una sesión de PocketBase: dónde, el token y de quién es. */
data class Sesion(val base: String, val token: String, val uid: String, val email: String)

/**
 * El cliente REST de PocketBase sobre HttpURLConnection (el mismo de la app
 * de tareas): nada de librerías de red. Todo es `suspend` y corre en IO.
 */
class Api(private val base: () -> String, private val token: () -> String?) {
    private val json = Json { ignoreUnknownKeys = true }

    private fun url(path: String) = URL(base().trimEnd('/') + path)
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    suspend fun pedir(metodo: String, path: String, body: JsonElement? = null, timeoutMs: Int = 20_000, auth: Boolean = true): JsonElement =
        withContext(Dispatchers.IO) {
            val c = try { url(path).openConnection() as HttpURLConnection } catch (e: Exception) { throw ErrorApi(0, "dirección del servidor no válida") }
            try {
                c.requestMethod = metodo
                c.connectTimeout = 12_000
                c.readTimeout = timeoutMs
                c.setRequestProperty("Accept", "application/json")
                if (auth) token()?.takeIf { it.isNotEmpty() }?.let { c.setRequestProperty("Authorization", it) }
                if (body != null) {
                    c.doOutput = true
                    c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
                val code = try { c.responseCode } catch (e: SocketTimeoutException) { throw ErrorApi(0, "el servidor no respondió a tiempo") }
                    catch (e: IOException) { throw ErrorApi(0, "no se pudo conectar con el servidor") }
                val txt = (if (code in 200..299) c.inputStream else c.errorStream)?.use { s ->
                    BufferedReader(InputStreamReader(s, Charsets.UTF_8)).readText()
                } ?: ""
                val data = if (code == 204 || txt.isBlank()) JsonObject(emptyMap()) else runCatching { json.parseToJsonElement(txt) }.getOrElse { JsonObject(emptyMap()) }
                if (code !in 200..299) throw ErrorApi(code, ((data as? JsonObject)?.get("message")).s ?: "HTTP $code")
                data
            } catch (e: ErrorApi) { throw e }
            catch (e: IOException) { throw ErrorApi(0, "no se pudo conectar con el servidor") }
            finally { c.disconnect() }
        }

    /** auth-with-password contra la colección `users` (nunca superusuarios). */
    suspend fun entrar(email: String, pass: String): Sesion {
        val d = pedir("POST", "/api/collections/users/auth-with-password",
            JsonObject(mapOf("identity" to JsonPrimitive(email), "password" to JsonPrimitive(pass))), auth = false) as JsonObject
        val rec = d["record"] as? JsonObject
        return Sesion(base().trimEnd('/'), d["token"].txt, rec?.get("id").txt, email)
    }

    /** Renueva el token y trae el registro del usuario (sus ajustes). null si la sesión ya no vale. */
    suspend fun renovar(): JsonObject? = try {
        pedir("POST", "/api/collections/users/auth-refresh") as JsonObject
    } catch (e: ErrorApi) { if (e.status == 401 || e.status == 403) null else throw e }

    /** Una colección por páginas. `filtro` y `campos` son opcionales. */
    suspend fun listar(col: String, filtro: String? = null, campos: String? = null, porPagina: Int = 200): List<JsonObject> {
        val out = ArrayList<JsonObject>()
        var page = 1
        while (true) {
            val q = StringBuilder("/api/collections/$col/records?page=$page&perPage=$porPagina&skipTotal=1")
            if (filtro != null) q.append("&filter=").append(enc(filtro))
            if (campos != null) q.append("&fields=").append(enc(campos))
            val d = pedir("GET", q.toString(), timeoutMs = 60_000) as JsonObject
            val items = (d["items"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
            out += items
            if (items.size < porPagina) break
            page++
        }
        return out
    }

    suspend fun crear(col: String, body: JsonObject) = pedir("POST", "/api/collections/$col/records", body) as JsonObject
    suspend fun parchear(col: String, id: String, body: JsonObject) = pedir("PATCH", "/api/collections/$col/records/$id", body) as JsonObject
    suspend fun borrar(col: String, id: String) { pedir("DELETE", "/api/collections/$col/records/$id") }
    suspend fun leer(col: String, id: String): JsonObject? = try {
        pedir("GET", "/api/collections/$col/records/$id") as JsonObject
    } catch (e: ErrorApi) { if (e.status == 404) null else throw e }

    /** El buscador (palabras + errores tipográficos + significado). */
    suspend fun buscar(q: String, carpeta: String?, etiqueta: String?): List<Pair<String, String>> {
        val path = StringBuilder("/search?limit=30&q=").append(enc(q))
        if (!carpeta.isNullOrEmpty()) path.append("&folder=").append(enc(carpeta))
        if (etiqueta != null) path.append("&tag=").append(enc(etiqueta))
        val d = pedir("GET", path.toString()) as JsonObject
        return (d["results"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let { r -> r["id"].txt to r["fragment"].txt.replace(Regex("</?mark>"), "") } } ?: emptyList()
    }

    /** Sube una imagen como adjunto de una nota (multipart). El id lo elige el
     *  cliente: el Markdown (`attachments/<id>`) se escribe antes de subir. */
    suspend fun subirAdjunto(id: String, nota: String, nombre: String, mime: String, bytes: ByteArray): JsonObject = withContext(Dispatchers.IO) {
        val limite = "----papernotes" + System.nanoTime()
        val c = url("/api/collections/attachments/records").openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 12_000
            c.readTimeout = 120_000
            c.doOutput = true
            token()?.let { c.setRequestProperty("Authorization", it) }
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=$limite")
            val buf = ByteArrayOutputStream(bytes.size + 512)
            fun campo(k: String, v: String) = buf.write("--$limite\r\nContent-Disposition: form-data; name=\"$k\"\r\n\r\n$v\r\n".toByteArray())
            campo("id", id); campo("note", nota); campo("kind", "image")
            buf.write("--$limite\r\nContent-Disposition: form-data; name=\"file\"; filename=\"${nombre.replace("\"", "")}\"\r\nContent-Type: $mime\r\n\r\n".toByteArray())
            buf.write(bytes)
            buf.write("\r\n--$limite--\r\n".toByteArray())
            c.setFixedLengthStreamingMode(buf.size())
            c.outputStream.use { buf.writeTo(it) }
            val code = c.responseCode
            val txt = (if (code in 200..299) c.inputStream else c.errorStream)?.use { BufferedReader(InputStreamReader(it)).readText() } ?: ""
            if (code !in 200..299) throw ErrorApi(code, runCatching { (json.parseToJsonElement(txt) as JsonObject)["message"].s }.getOrNull() ?: "HTTP $code")
            json.parseToJsonElement(txt) as JsonObject
        } catch (e: ErrorApi) { throw e }
        catch (e: IOException) { throw ErrorApi(0, "no se pudo subir la imagen") }
        finally { c.disconnect() }
    }

    /**
     * El tiempo real de PocketBase, hecho a mano como en la web: un GET que se
     * queda abierto (SSE); el primer evento trae el clientId y con él se
     * suscribe. Vuelve cuando la conexión se cae; quien llama reintenta.
     */
    suspend fun tiempoReal(colecciones: List<String>, onConectado: () -> Unit, onEvento: (String, JsonObject) -> Unit) {
        withContext(Dispatchers.IO) {
            val c = url("/api/realtime").openConnection() as HttpURLConnection
            // readLine() no se entera de una cancelación: cortar la conexión sí lo despierta.
            val corte = currentCoroutineContext()[Job]?.invokeOnCompletion { runCatching { c.disconnect() } }
            try {
                c.connectTimeout = 12_000
                c.readTimeout = 6 * 60_000
                c.setRequestProperty("Accept", "text/event-stream")
                val r = BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8))
                var evento = ""
                val data = StringBuilder()
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val linea = r.readLine() ?: break
                    when {
                        linea.isEmpty() -> {
                            if (data.isNotEmpty()) {
                                val d = data.toString()
                                if (evento == "PB_CONNECT") {
                                    val id = runCatching { (json.parseToJsonElement(d) as JsonObject)["clientId"].s }.getOrNull()
                                    if (id != null) {
                                        pedir("POST", "/api/realtime", JsonObject(mapOf(
                                            "clientId" to JsonPrimitive(id),
                                            "subscriptions" to JsonArray(colecciones.map { JsonPrimitive(it) }),
                                        )))
                                        onConectado()
                                    }
                                } else if (evento in colecciones) {
                                    runCatching { json.parseToJsonElement(d) as JsonObject }.getOrNull()?.let { onEvento(evento, it) }
                                }
                            }
                            evento = ""; data.setLength(0)
                        }
                        linea.startsWith("event:") -> evento = linea.substring(6).trim()
                        linea.startsWith("data:") -> { if (data.isNotEmpty()) data.append('\n'); data.append(linea.substring(5).trimStart()) }
                    }
                }
            } catch (e: IOException) { /* se cayó: quien llama reintenta */ }
            finally { corte?.dispose(); c.disconnect() }
        }
    }
}

/** Los mensajes de PocketBase son de bajo nivel y en inglés: se traducen los
 *  que el usuario puede provocar. */
fun mensajeDeEntrada(e: Throwable): String {
    val m = e.message ?: ""
    return when {
        Regex("failed to authenticate|invalid credentials", RegexOption.IGNORE_CASE).containsMatchIn(m) -> "Correo o contraseña incorrectos."
        e is ErrorApi && e.status == 0 -> "Sin conexión con el servidor. Revisa la dirección."
        Regex("something went wrong", RegexOption.IGNORE_CASE).containsMatchIn(m) -> "El servidor rechazó la petición. Revisa el correo."
        m.isNotEmpty() -> m
        else -> "No pude iniciar sesión."
    }
}
