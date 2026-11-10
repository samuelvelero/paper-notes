#!/usr/bin/env bash
# Publica la beta de Android (Paper Notes, com.samukis.papernotes) en el
# servidor, de donde la instala y la actualiza Obtainium:
#
#   <URL>                                    ← la página (y la fuente de Obtainium)
#   <URL>paper-notes-0.1.0-beta.N.apk
#
# N es el número de commits de HEAD, así que cada publicación va sobre un
# commit nuevo: con android/ sucio se niega, porque dos APKs distintos con el
# mismo número no se instalan uno encima del otro y Obtainium no vería el cambio.
#
# Va firmada con la llave de DEPURACIÓN de este PC (~/.android/debug.keystore).
# Obtainium solo actualiza si la firma no cambia: publicar desde otra máquina
# obliga a desinstalar la beta una vez.
#
# Dónde se sube NO está en el repo (es público): se lee de android/publicar.env
# (ignorado por git; ver publicar.env.example).
#
# Uso (Git Bash, desde cualquier sitio):  android/scripts/publicar-beta.sh
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f publicar.env ] || { echo "Falta android/publicar.env (copia publicar.env.example y rellénalo)." >&2; exit 1; }
# shellcheck disable=SC1091
. ./publicar.env
: "${SERVER:?}" "${DEST:?}" "${URL:?}"

if [ -n "$(git status --porcelain -- .)" ]; then
  echo "android/ tiene cambios sin commit: commitea primero (el número de la beta sale del commit)." >&2
  exit 1
fi

N=$(git rev-list --count HEAD)
BASE=$(sed -n 's/.*versionName = "\(.*\)".*/\1/p' app/build.gradle.kts | head -1)
VER="$BASE-beta.$N"
APK="paper-notes-$VER.apk"

export JAVA_HOME="${JAVA_HOME:-/c/Program Files/Android/Android Studio/jbr}"
# SERVIDOR_APP (opcional, en publicar.env): el servidor que la entrada trae escrito.
./gradlew -q ":core:test" ":app:assembleBeta" "-PpaperBuild=$N" ${SERVIDOR_APP:+"-PpaperServidor=$SERVIDOR_APP"}

TMP=$(mktemp -d)
cp app/build/outputs/apk/beta/app-beta.apk "$TMP/$APK"

# El enlace para añadirla a Obtainium con todo configurado: fuente HTML, la
# página de arriba, y la versión sacada del nombre del archivo.
ENC=$(node -e '
  const settings = {
    customLinkFilterRegex: String.raw`paper-notes-.*\.apk$`,     // solo el APK, no los otros enlaces de la página
    versionExtractionRegEx: String.raw`paper-notes-(.+)\.apk`,   // la versión sale del nombre del archivo...
    matchGroupToUse: "1",
    versionDetection: true,                                      // ...y coincide con el versionName instalado
  };
  // La carpeta, no index.html: el servidor redirige index.html a la carpeta.
  const app = { id: "com.samukis.papernotes", url: process.argv[1], author: "Samukis",
    name: "Paper Notes", overrideSource: "HTML", additionalSettings: JSON.stringify(settings) };
  process.stdout.write(encodeURIComponent(JSON.stringify(app)));
' "$URL")

cat > "$TMP/index.html" <<HTML
<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Paper Notes para Android</title>
<style>
  :root{color-scheme:light dark;--bg:#F5F5F7;--card:#fff;--tx:#111113;--tx2:#5C5C62;--amber:#FFB300;--ink:#1A1200;--hair:rgba(0,0,0,.12)}
  @media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1E1E21;--tx:#F2F2F4;--tx2:#B5B5BB;--hair:rgba(255,255,255,.14)}}
  body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.45 system-ui,-apple-system,sans-serif}
  main{max-width:420px;margin:0 auto;padding:48px 20px}
  .c{background:var(--card);border-radius:28px;padding:30px 26px}
  h1{font-size:26px;font-weight:500;margin:0 0 6px} p{color:var(--tx2);margin:0 0 26px}
  a.b{display:block;text-align:center;padding:14px;border-radius:14px;text-decoration:none;font-weight:600;margin-bottom:12px}
  a.p{background:var(--amber);color:var(--ink)} a.s{border:1px solid var(--hair);color:var(--tx)}
  small{display:block;color:var(--tx2);margin-top:22px}
</style></head><body><main><div class="c">
<h1>Paper Notes</h1>
<p>Versión $VER · app nativa de Android. Entra con tu cuenta del servidor.</p>
<a class="b p" href="obtainium://app/$ENC">Añadir a Obtainium</a>
<a class="b s" href="$URL$APK">Descargar el APK</a>
<small>Obtainium vigila esta página y avisa cuando hay una versión nueva.</small>
</div></main></body></html>
HTML

ssh "$SERVER" "mkdir -p $DEST && rm -f $DEST/*.apk"
scp -q "$TMP/$APK" "$TMP/index.html" "$SERVER:$DEST/"
rm -rf "$TMP"

echo "Publicada $VER"
echo "Página:    $URL"
echo "APK:       $URL$APK"
echo "Obtainium: obtainium://app/$ENC"
