# Paper Notes para Android — contexto

La app nativa de notas (Fase 5 de `../PLAN.md`). Kotlin + Compose, hermana
de la app nativa de tareas: mismas reglas, mismo esqueleto, mismas lecciones.
Habla con Samuel en español.

**Es pública, como el resto del repo.** Nada de servidores, alias de ssh ni
rutas de nadie: el APK público trae la entrada con el servidor VACÍO (cada
quien pone el suyo). Lo propio de quien publica vive fuera de git:
`publicar.env` (dónde subir la beta y qué servidor trae escrito) y
`local.properties`.

## Estado (10 nov 2026): 0.1.0, probada en el emulador

Entrar, lista (cuadrícula/lista, fijadas, etiquetas, búsqueda local y la del
buscador al confirmar), carpetas anidadas, papelera, ajustes, editor nativo
por bloques, enlace público, captura rápida flotante, dos tiles de ajustes
rápidos, «Compartir a Paper Notes», dos widgets, atajos del icono y
`papernotes://note/<id>`. **Falta validarla en un teléfono real** (teclado
real, 120/144 Hz, widgets en el launcher del fabricante).

Fuera de v1, a propósito: seleccionar texto a través de varios bloques, tocar
un enlace/etiqueta para seguirlo (tocar pone el cursor), subir imágenes sin
conexión, historial de versiones, ContentProvider para Quick Search.

## Módulos

- `core/` (Kotlin puro, se prueba sin Android):
  · `Blocks.kt`: Markdown ↔ lista plana de bloques con `depth`. Es el mismo
    dialecto que `pb_public/js/mdpm.js`, y su contrato es que la forma
    canónica de la web va y vuelve IGUAL (abrir una nota en el teléfono no
    la reescribe). El texto de un bloque es Markdown inline tal cual.
  · `Inline.kt`: el formato inline como RANGOS sobre el texto (estilos y
    marcas), el mismo análisis que `inline()` de mdpm.js.
  · `Derive.kt`: título, texto plano, etiquetas, extracto (md.js) y fechas.
  · Casos de oro: `node android/scripts/oro-md.js` pasa una lista de Markdown
    por el mdpm.js y el md.js de la web y escribe `golden/md.json`;
    `BlocksTest` exige lo mismo a Kotlin. Si cambia el dialecto en la web,
    se regenera y se arregla Kotlin hasta que pase.
- `app/`:
  · `data/Almacen.kt`: todo en memoria (una foto inmutable, `datos`), SQLite
    a pelo (`Db.kt`: cada registro es su JSON), cola de MARCAS (nuevo / sucio
    / borrado; se sube el registro como esté), carga incremental
    (`updated >= marca` + lista de ids para los borrados) y tiempo real por
    SSE con la app a la vista. `Api.kt` es HttpURLConnection. `Imagenes.kt`,
    caché de memoria y disco sin librería.
  · `ui/`: `Tema.kt` (tokens de `styles.css`, Geist, `Texto`, `Icono`),
    `Iconos.kt` (GENERADO desde `icons.js` con `scripts/iconos-web.js`),
    `Comun.kt` (`toque`, hojas, avisos), `Estado.kt` (`Ui`: pila de
    pantallas, vive en la Application), `Lista.kt`, `Pantallas.kt`.
  · `ui/editor/`: `Editor.kt` (TODA la lógica: partir, unir, reglas de
    entrada, pegar, deshacer, barra), `Bloques.kt` (un campo por bloque y el
    `VisualTransformation` del inline), `Nota.kt` (pantalla y barra).
  · `CapturaRapida.kt`: la Activity flotante (tile, compartir, widget) y los
    dos `TileService`. `widget/Widgets.kt`: RemoteViews a pelo.
    `PaperApp.kt`: el proceso y `Refresco` (JobScheduler).

## Reglas (las de «Do», no reabrir)

- **Nada de Material**: `foundation` y los tokens. El texto va con `Texto` o
  con un `TextStyle` que diga `fontFamily = Geist`.
- **La web es la maqueta**: colores, radios, tamaños e iconos salen de
  `pb_public/` (los px son dp). Los iconos no se dibujan a mano: se regeneran.
- **Se escribe solo por `Almacen`**, en el hilo principal; la red va detrás.
  Lo pendiente de subir no lo pisa ni una carga ni el tiempo real.
- **El editor no reescribe el texto del usuario**: las marcas inline se
  pintan apagadas en el bloque con el cursor y se esconden en los demás.
- **El teclado manda cambios compuestos**: un Enter puede llegar junto con la
  palabra autocorregida (`alCambiar` mira lo insertado entre prefijo y
  sufijo comunes; un solo `\n` es Enter aunque venga con más texto).
  Retroceso al principio de un bloque llega como TECLA (`onPreviewKeyEvent`):
  el teclado la manda cuando no hay nada que borrar.
- **Lo que una pantalla lanza y debe sobrevivirla va en el ámbito del
  almacén** (la entrada desaparece al haber sesión y cancelaba la descarga).
- **120/144 Hz**: `pedirTasaMaxima` en `MainActivity`; la beta es el release
  con R8 (un APK depurable no llega). Listas con `key` y `contentType`; las
  tarjetas reciben la `Nota` inmutable.

## Compilar y probar

```bash
cd android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :core:test assembleDebug
```

- Depuración (`.debug`, http): habla con un PocketBase local en
  `10.0.2.2:<puerto>` desde el emulador (ver CLAUDE.md de la raíz
  para levantar PocketBase; el puerto está en `app/build.gradle.kts`).
- La beta contra ese mismo PocketBase: `./gradlew assembleBeta -PpaperLocal`
  (deja pasar http; nunca se publica así).
- Con adb y un dispositivo físico enchufado, siempre `-s emulator-5554`.
  El texto por adb va más rápido que el foco entre bloques: pausas de ~0,5 s.

## Publicar la beta (Obtainium)

```bash
android/scripts/publicar-beta.sh
```

Compila la beta con `-PpaperBuild=N` (N = commits de HEAD), y sube el APK y
una página a la carpeta `apk/` del servidor (`publicar.env`, fuera de git).
La página es la fuente HTML de Obtainium (la versión sale del nombre del
archivo) y trae el botón «Añadir a Obtainium». Se niega con `android/` sucio.
Firma: la llave de depuración de ESTE PC (publicar desde otra máquina obliga
a desinstalar una vez). El service worker de la web deja pasar `/apk/`.

## Publicar en GitHub (release pública)

El APK de las releases de GitHub es el `beta` compilado SIN `paperServidor`
(entrada vacía) y con `-PpaperBuild=N`; va adjunto a una release con etiqueta
`android-vX.Y.Z` del repo `paper-notes`. Misma firma que la beta de
Obtainium, así que uno se instala encima del otro.
