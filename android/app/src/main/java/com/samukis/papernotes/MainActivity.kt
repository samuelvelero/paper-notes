package com.samukis.papernotes

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.DisposableEffect
import androidx.lifecycle.lifecycleScope
import com.samukis.papernotes.ui.C
import com.samukis.papernotes.ui.PaperTheme
import com.samukis.papernotes.ui.Raiz
import kotlinx.coroutines.launch

/**
 * La única Activity de la app (la captura rápida es otra, flotante). Aquí solo
 * se pinta y se recibe lo que llega de fuera: los atajos del icono, los
 * widgets, el tile de buscar y los enlaces `papernotes://note/<id>`.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        pedirTasaMaxima()
        if (savedInstanceState == null) manejar(intent)
        setContent {
            PaperTheme {
                val oscuro = C.oscuro
                DisposableEffect(oscuro) {
                    val estilo = if (oscuro) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                    enableEdgeToEdge(statusBarStyle = estilo, navigationBarStyle = estilo)
                    onDispose { }
                }
                Raiz(app.alm, app.ui)
            }
        }
    }

    /**
     * Pide el modo de pantalla más rápido que tenga la misma resolución (120 o
     * 144 Hz donde lo hay). Varios fabricantes dejan en 60 Hz a las apps que
     * no lo piden aunque el teléfono pueda más.
     */
    private fun pedirTasaMaxima() {
        val pantalla = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else @Suppress("DEPRECATION") windowManager.defaultDisplay
        pantalla ?: return
        val ahora = pantalla.mode
        val mejor = pantalla.supportedModes
            .filter { it.physicalWidth == ahora.physicalWidth && it.physicalHeight == ahora.physicalHeight }
            .maxByOrNull { it.refreshRate } ?: return
        if (window.attributes.preferredDisplayModeId != mejor.modeId)
            window.attributes = window.attributes.apply { preferredDisplayModeId = mejor.modeId }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        manejar(intent)
    }

    /** Lo que llega de fuera espera a que el disco esté leído. */
    private fun manejar(i: Intent?) {
        val accion = i?.action ?: return
        if (accion == Intent.ACTION_MAIN) return
        lifecycleScope.launch {
            val alm = app.alm
            val ui = app.ui
            alm.cargado.await()
            if (!alm.haySesion) return@launch
            when (accion) {
                ACCION_NUEVA -> { ui.aLista(ui.carpeta); val n = alm.nuevaNota(i.getStringExtra("carpeta") ?: ui.carpeta ?: ""); ui.abrirNota(n.id, nueva = true) }
                ACCION_BUSCAR -> { ui.aLista(null); ui.enfocarBusqueda = true }
                ACCION_NOTA -> i.getStringExtra("id")?.let { if (alm.datos.nota(it) != null) { ui.aLista(ui.carpeta); ui.abrirNota(it) } }
                Intent.ACTION_VIEW -> i.data?.takeIf { it.scheme == "papernotes" && it.host == "note" }?.lastPathSegment?.let { if (alm.datos.nota(it) != null) { ui.aLista(ui.carpeta); ui.abrirNota(it) } }
            }
            // Que un giro de pantalla no repita la acción.
            setIntent(Intent(this@MainActivity, MainActivity::class.java))
        }
    }

    companion object {
        const val ACCION_NUEVA = "com.samukis.papernotes.NUEVA"
        const val ACCION_BUSCAR = "com.samukis.papernotes.BUSCAR"
        const val ACCION_NOTA = "com.samukis.papernotes.NOTA"
    }
}
