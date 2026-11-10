package com.samukis.papernotes.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * La caché local: el SQLite de la plataforma, sin Room. Tres tablas y nada de
 * esquema por campo: cada registro es su JSON (la app los tiene todos en
 * memoria; el disco solo es para volver a arrancar sin red).
 *
 *   rec(kind, id, json)        notas, carpetas y adjuntos
 *   pend(kind, id, op, cuerpo) lo que falta por subir (ver Almacen)
 *   meta(k, v)                 la marca de la última sincronización, el dueño
 *
 * Todas las llamadas llegan por el hilo único de disco de Almacen.
 */
class Db(ctx: Context) : SQLiteOpenHelper(ctx, "paper.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE rec (kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (kind, id))")
        db.execSQL("CREATE TABLE pend (kind TEXT NOT NULL, id TEXT NOT NULL, op TEXT NOT NULL, cuerpo INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (kind, id))")
        db.execSQL("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)")
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {}

    fun registros(kind: String): List<String> {
        val out = ArrayList<String>()
        readableDatabase.rawQuery("SELECT json FROM rec WHERE kind = ?", arrayOf(kind)).use { c -> while (c.moveToNext()) out += c.getString(0) }
        return out
    }
    /** kind, id, op, cuerpo */
    fun pendientes(): List<Array<String>> {
        val out = ArrayList<Array<String>>()
        readableDatabase.rawQuery("SELECT kind, id, op, cuerpo FROM pend", null).use { c ->
            while (c.moveToNext()) out += arrayOf(c.getString(0), c.getString(1), c.getString(2), c.getString(3))
        }
        return out
    }
    fun meta(k: String): String? = readableDatabase.rawQuery("SELECT v FROM meta WHERE k = ?", arrayOf(k)).use { c -> if (c.moveToFirst()) c.getString(0) else null }
    fun meta(k: String, v: String?) {
        if (v == null) writableDatabase.delete("meta", "k = ?", arrayOf(k))
        else writableDatabase.insertWithOnConflict("meta", null, ContentValues().apply { put("k", k); put("v", v) }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun poner(kind: String, id: String, json: String) {
        writableDatabase.insertWithOnConflict("rec", null, ContentValues().apply { put("kind", kind); put("id", id); put("json", json) }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    fun quitar(kind: String, id: String) { writableDatabase.delete("rec", "kind = ? AND id = ?", arrayOf(kind, id)) }
    fun ponerPend(kind: String, id: String, op: String, cuerpo: Boolean) {
        writableDatabase.insertWithOnConflict("pend", null, ContentValues().apply { put("kind", kind); put("id", id); put("op", op); put("cuerpo", if (cuerpo) 1 else 0) }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    fun quitarPend(kind: String, id: String) { writableDatabase.delete("pend", "kind = ? AND id = ?", arrayOf(kind, id)) }

    fun <T> lote(f: () -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        try { val r = f(); db.setTransactionSuccessful(); return r } finally { db.endTransaction() }
    }
    fun vaciar() = lote { writableDatabase.delete("rec", null, null); writableDatabase.delete("pend", null, null); writableDatabase.delete("meta", null, null) }
}
