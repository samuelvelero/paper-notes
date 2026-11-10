package com.samukis.papernotes.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Las imágenes de las notas, sin librería: memoria (LruCache por bytes) →
 * disco (cacheDir/img, por el hash de la URL) → red. Se decodifican fuera del
 * hilo principal y ya reducidas a lo que la pantalla necesita, que es lo que
 * mantiene la lista fluida al pasar tarjetas con portada.
 */
object Imagenes {
    private lateinit var dir: File
    private val memoria = object : LruCache<String, ImageBitmap>((Runtime.getRuntime().maxMemory() / 6).toInt()) {
        override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
    }
    private val candados = HashMap<String, Mutex>()

    fun iniciar(ctx: Context) { dir = File(ctx.cacheDir, "img").apply { mkdirs() } }

    fun enMemoria(url: String): ImageBitmap? = memoria.get(url)

    private fun clave(url: String) = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }

    suspend fun cargar(url: String, anchoMax: Int = 1080): ImageBitmap? {
        memoria.get(url)?.let { return it }
        val candado = synchronized(candados) { candados.getOrPut(url) { Mutex() } }
        return candado.withLock {
            memoria.get(url) ?: withContext(Dispatchers.IO) {
                runCatching {
                    val f = File(dir, clave(url))
                    if (!f.exists() || f.length() == 0L) descargar(url, f)
                    decodificar(f, anchoMax)?.asImageBitmap()?.also { memoria.put(url, it) }
                }.getOrNull()
            }
        }.also { synchronized(candados) { candados.remove(url) } }
    }

    private fun descargar(url: String, destino: File) {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 12_000; c.readTimeout = 60_000
            if (c.responseCode !in 200..299) error("HTTP ${c.responseCode}")
            val tmp = File(destino.path + ".tmp")
            c.inputStream.use { i -> tmp.outputStream().use { o -> i.copyTo(o) } }
            tmp.renameTo(destino)
        } finally { c.disconnect() }
    }

    private fun decodificar(f: File, anchoMax: Int): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, o)
        if (o.outWidth <= 0) { f.delete(); return null }
        var muestra = 1
        while (o.outWidth / (muestra * 2) >= anchoMax) muestra *= 2
        return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = muestra })
    }
}

/** La imagen de una URL como estado: null mientras llega (o si falla). */
@Composable
fun rememberImagen(url: String?, anchoMax: Int = 1080): State<ImageBitmap?> =
    produceState(initialValue = url?.let { Imagenes.enMemoria(it) }, url) {
        value = if (url == null) null else Imagenes.enMemoria(url) ?: Imagenes.cargar(url, anchoMax)
    }
