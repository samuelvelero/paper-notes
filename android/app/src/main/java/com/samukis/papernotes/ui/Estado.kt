package com.samukis.papernotes.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

sealed interface Pantalla {
    data object Lista : Pantalla
    data object Carpetas : Pantalla
    data object Ajustes : Pantalla
    data object Papelera : Pantalla
    data class Nota(val id: String, val nueva: Boolean = false) : Pantalla
}

class Aviso(val texto: String, val accion: String? = null, val alPulsar: (() -> Unit)? = null, val id: Long = System.nanoTime())

/**
 * El estado de la interfaz: qué pantalla, qué carpeta, qué se busca, la hoja
 * abierta. Vive en la Application (no en la Activity): girar la pantalla o
 * volver de otra app no pierde dónde estabas.
 */
class Ui(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("ajustes", Context.MODE_PRIVATE)

    val pila = mutableStateListOf<Pantalla>(Pantalla.Lista)
    /** Para la animación: ¿la última navegación fue hacia delante? */
    var adelante by mutableStateOf(true); private set

    /** null = Todo, "" = las sueltas («Notas»), id = esa carpeta. */
    var carpeta by mutableStateOf<String?>(null)
    var etiqueta by mutableStateOf<String?>(null)
    var q by mutableStateOf("")
    /** Resultados del buscador (id, fragmento) al confirmar la búsqueda. */
    var remotos by mutableStateOf<List<Pair<String, String>>?>(null)
    var enfocarBusqueda by mutableStateOf(false)

    var hoja by mutableStateOf<(@Composable () -> Unit)?>(null)
    var aviso by mutableStateOf<Aviso?>(null)

    // Ajustes del dispositivo (los de la cuenta viven en Almacen).
    var diseno by mutableStateOf(prefs.getString("layout", "grid")!!); private set
    var orden by mutableStateOf(prefs.getString("sort", "updated")!!); private set
    var fuente by mutableStateOf(prefs.getString("font", "m")!!); private set
    fun ponerDiseno(v: String) { diseno = v; prefs.edit().putString("layout", v).apply() }
    fun ponerOrden(v: String) { orden = v; prefs.edit().putString("sort", v).apply() }
    fun ponerFuente(v: String) { fuente = v; prefs.edit().putString("font", v).apply() }
    /** El tamaño base del editor, como `--ed-size` de la web. */
    val tamEditor get() = when (fuente) { "s" -> 15f; "l" -> 19f; else -> 17f }

    val actual get() = pila.last()

    fun ir(p: Pantalla) { hoja = null; adelante = true; pila.add(p) }
    /** Un nivel atrás. false si ya no hay adónde (sale de la app). */
    fun atras(): Boolean {
        if (hoja != null) { hoja = null; return true }
        if (pila.size <= 1) return false
        adelante = false
        pila.removeAt(pila.lastIndex)
        return true
    }
    fun aLista(carpeta: String?) { this.carpeta = carpeta; etiqueta = null; remotos = null; hoja = null; adelante = false; while (pila.size > 1) pila.removeAt(pila.lastIndex) }
    fun abrirNota(id: String, nueva: Boolean = false) {
        hoja = null
        /* una nota abierta encima de otra (enlace, widget) la sustituye */
        if (actual is Pantalla.Nota) { adelante = true; pila[pila.lastIndex] = Pantalla.Nota(id, nueva) } else ir(Pantalla.Nota(id, nueva))
    }
    fun avisar(texto: String, accion: String? = null, alPulsar: (() -> Unit)? = null) { aviso = Aviso(texto, accion, alPulsar) }
    fun reiniciar() { pila.clear(); pila.add(Pantalla.Lista); carpeta = null; etiqueta = null; q = ""; remotos = null; hoja = null }
}
