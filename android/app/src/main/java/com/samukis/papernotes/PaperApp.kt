package com.samukis.papernotes

import android.app.Application
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import com.samukis.papernotes.data.Almacen
import com.samukis.papernotes.data.Imagenes
import com.samukis.papernotes.ui.Ui
import com.samukis.papernotes.widget.Widgets
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * El proceso. Los datos (`alm`) y el estado de la interfaz (`ui`) viven aquí
 * y no en la Activity: los comparten la app, la captura rápida, los widgets y
 * el trabajo en segundo plano, y girar la pantalla no pierde nada.
 */
class PaperApp : Application() {
    lateinit var alm: Almacen; private set
    lateinit var ui: Ui; private set

    override fun onCreate() {
        super.onCreate()
        Imagenes.iniciar(this)
        alm = Almacen(this)
        ui = Ui(this)
        alm.alCambiar = { Widgets.pedirRepintado(this) }
        /* A la vista = tiempo real y ponerse al día. Al irse: se sube lo que
           quede y se deja un trabajo por si el sistema mata el proceso antes. */
        ProcessLifecycleOwner.get().lifecycle.addObserver(LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> alm.alVolver()
                Lifecycle.Event.ON_STOP -> { alm.alIrse(); if (alm.pendientes > 0) Refresco.subirPronto(this) }
                else -> {}
            }
        })
        Refresco.programar(this)
    }
}

val Context.app get() = applicationContext as PaperApp

/**
 * Con la app cerrada: cada pocas horas (y con red) trae lo que cambió en otros
 * dispositivos para que los widgets no enseñen notas viejas, y sube lo que la
 * captura rápida dejó pendiente.
 */
class Refresco : JobService() {
    private val ambito = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onStartJob(params: JobParameters): Boolean {
        ambito.launch {
            try { withTimeoutOrNull(60_000) { app.alm.refrescar() }; Widgets.repintar(this@Refresco) }
            finally { jobFinished(params, false) }
        }
        return true
    }
    override fun onStopJob(params: JobParameters) = true

    companion object {
        private fun trabajo(ctx: Context, id: Int) = JobInfo.Builder(id, ComponentName(ctx, Refresco::class.java)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        fun programar(ctx: Context) {
            val js = ctx.getSystemService(JobScheduler::class.java)
            if (js.getPendingJob(1) == null) runCatching { js.schedule(trabajo(ctx, 1).setPeriodic(3 * 3600_000L).build()) }
        }
        fun subirPronto(ctx: Context) {
            runCatching { ctx.getSystemService(JobScheduler::class.java).schedule(trabajo(ctx, 2).setMinimumLatency(2000).setOverrideDeadline(15 * 60_000L).build()) }
        }
    }
}
