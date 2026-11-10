package com.samukis.papernotes.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.samukis.papernotes.CapturaRapida
import com.samukis.papernotes.MainActivity
import com.samukis.papernotes.R
import com.samukis.papernotes.app
import com.samukis.papernotes.core.Derive
import com.samukis.papernotes.core.Fechas
import com.samukis.papernotes.data.Nota
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Los widgets, con RemoteViews a pelo (sin Glance, como en tareas):
 *
 *  - «Notas» (`WidgetLista`): las fijadas primero y luego las más recientes,
 *    con buscar y + en la cabecera. Tocar una nota la abre.
 *  - «Nota rápida» (`WidgetRapido`): una píldora que abre el cuadro flotante.
 *
 * No se repintan por reloj: los repinta la app cuando cambian los datos
 * (`Almacen.alCambiar` → `pedirRepintado`) y el trabajo de fondo (`Refresco`).
 * Los colores son recursos (colors.xml en values y values-night): los resuelve el launcher y
 * siguen al modo oscuro del sistema.
 */
object Widgets {
    private val mano = Handler(Looper.getMainLooper())
    private var pedido = false

    /** Muchos cambios seguidos (escribir) son un solo repintado. */
    fun pedirRepintado(ctx: Context) {
        if (pedido) return
        pedido = true
        mano.postDelayed({ pedido = false; repintar(ctx.applicationContext) }, 1500)
    }

    fun repintar(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        val ids = mgr.getAppWidgetIds(ComponentName(ctx, WidgetLista::class.java))
        if (ids.isEmpty()) return
        for (id in ids) mgr.updateAppWidget(id, vistaLista(ctx, id))
        @Suppress("DEPRECATION") mgr.notifyAppWidgetViewDataChanged(ids, R.id.lista)
    }

    private fun actividad(ctx: Context, codigo: Int, i: Intent, mutable: Boolean = false) =
        PendingIntent.getActivity(ctx, codigo, i, PendingIntent.FLAG_UPDATE_CURRENT or if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
    private fun principal(ctx: Context, accion: String) = Intent(ctx, MainActivity::class.java).setAction(accion).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun vistaLista(ctx: Context, id: Int): RemoteViews = RemoteViews(ctx.packageName, R.layout.widget_lista).apply {
        /* cada widget su adaptador: el Uri distinto evita que el launcher los comparta */
        val servicio = Intent(ctx, ServicioLista::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        servicio.data = Uri.parse(servicio.toUri(Intent.URI_INTENT_SCHEME))
        @Suppress("DEPRECATION") setRemoteAdapter(R.id.lista, servicio)
        setEmptyView(R.id.lista, R.id.vacio)
        setOnClickPendingIntent(R.id.titulo, actividad(ctx, 1, principal(ctx, Intent.ACTION_MAIN)))
        setOnClickPendingIntent(R.id.buscar, actividad(ctx, 2, principal(ctx, MainActivity.ACCION_BUSCAR)))
        setOnClickPendingIntent(R.id.nueva, actividad(ctx, 3, principal(ctx, MainActivity.ACCION_NUEVA)))
        setPendingIntentTemplate(R.id.lista, actividad(ctx, 4, principal(ctx, MainActivity.ACCION_NOTA), mutable = true))
    }

    fun vistaRapido(ctx: Context): RemoteViews = RemoteViews(ctx.packageName, R.layout.widget_rapido).apply {
        setOnClickPendingIntent(R.id.raiz, actividad(ctx, 5, Intent(ctx, CapturaRapida::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)))
    }
}

class WidgetLista : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) mgr.updateAppWidget(id, Widgets.vistaLista(ctx, id))
    }
}

class WidgetRapido : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) mgr.updateAppWidget(id, Widgets.vistaRapido(ctx))
    }
}

/** Las filas del widget de lista. Lee de la misma foto en memoria que la app. */
class ServicioLista : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = object : RemoteViewsFactory {
        private var notas: List<Nota> = emptyList()

        override fun onCreate() {}
        override fun onDestroy() {}
        override fun onDataSetChanged() {
            /* Corre en un hilo del launcher: puede esperar a que el disco esté leído. */
            val alm = app.alm
            runBlocking { withTimeoutOrNull(5000) { alm.cargado.await() } }
            val activas = alm.datos.activas
            notas = (activas.filter { it.pinned }.sortedByDescending { it.updated } + activas.filter { !it.pinned }.sortedByDescending { it.updated }).take(40)
        }
        override fun getCount() = notas.size
        override fun getViewAt(pos: Int): RemoteViews {
            val n = notas.getOrNull(pos) ?: return RemoteViews(packageName, R.layout.widget_fila)
            return RemoteViews(packageName, R.layout.widget_fila).apply {
                setTextViewText(R.id.fila_titulo, n.title.ifEmpty { "Sin título" })
                val extracto = Derive.excerpt(n.title, n.plain, 80)
                setTextViewText(R.id.fila_sub, Fechas.nice(n.updated) + if (extracto.isEmpty()) "" else "  $extracto")
                setViewVisibility(R.id.fila_pin, if (n.pinned) View.VISIBLE else View.GONE)
                setOnClickFillInIntent(R.id.fila, Intent().putExtra("id", n.id))
            }
        }
        override fun getLoadingView(): RemoteViews? = null
        override fun getViewTypeCount() = 1
        override fun getItemId(pos: Int) = notas.getOrNull(pos)?.id?.hashCode()?.toLong() ?: pos.toLong()
        override fun hasStableIds() = true
    }
}
