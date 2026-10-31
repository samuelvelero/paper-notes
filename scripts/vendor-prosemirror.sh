#!/bin/sh
# Reconstruye pb_public/js/prosemirror.js (el único vendorizado con build).
# Necesita npm solo aquí, una vez; el resultado se versiona. Uso:
#   sh scripts/vendor-prosemirror.sh
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
cd "$TMP"
npm init -y >/dev/null
npm i --silent --no-audit --no-fund prosemirror-model prosemirror-state prosemirror-view prosemirror-transform prosemirror-commands prosemirror-keymap prosemirror-history prosemirror-schema-list prosemirror-inputrules prosemirror-dropcursor prosemirror-gapcursor esbuild
cat > entry.js <<'JS'
export * as model from 'prosemirror-model';
export * as state from 'prosemirror-state';
export * as view from 'prosemirror-view';
export * as transform from 'prosemirror-transform';
export * as commands from 'prosemirror-commands';
export * as keymap from 'prosemirror-keymap';
export * as history from 'prosemirror-history';
export * as schemaList from 'prosemirror-schema-list';
export * as inputrules from 'prosemirror-inputrules';
export * as dropcursor from 'prosemirror-dropcursor';
export * as gapcursor from 'prosemirror-gapcursor';
JS
npx esbuild entry.js --bundle --format=iife --global-name=PM --minify --legal-comments=none --outfile=pm.js
VERS=$(node -e "const fs=require('fs');console.log(fs.readdirSync('node_modules').filter(n=>n.startsWith('prosemirror-')).map(n=>n+'@'+require('./node_modules/'+n+'/package.json').version).join(', '))")
{
  printf '/* ProseMirror, vendorizado en un solo archivo (MIT, Marijn Haverbeke y colaboradores).\n   Paquetes: %s.\n   Construido con esbuild (--format=iife --global-name=PM --minify) desde un\n   entry que reexporta cada paquete como espacio de nombres:\n     PM.model, PM.state, PM.view, PM.transform, PM.commands, PM.keymap,\n     PM.history, PM.schemaList, PM.inputrules, PM.dropcursor, PM.gapcursor.\n   Para actualizarlo: scripts/vendor-prosemirror.sh. Licencia: pb_public/js/prosemirror-LICENSE.txt. */\n' "$VERS"
  cat pm.js
} > "$ROOT/pb_public/js/prosemirror.js"
cp node_modules/prosemirror-view/LICENSE "$ROOT/pb_public/js/prosemirror-LICENSE.txt"
echo "listo: $(wc -c < "$ROOT/pb_public/js/prosemirror.js") bytes"
