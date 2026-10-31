# samukis-notes

Notas personales al estilo Apple Notes, **self-hosted** y sin servidores de
terceros: PocketBase en tu propio servidor, web ligera que funciona sin
conexión, búsqueda instantánea (léxica y semántica), conector MCP para que
Claude lea y escriba tus notas, y una app nativa de Android.

Estado: **Fase 0** (servidor, esquema y reglas). El plan por fases está en
[PLAN.md](PLAN.md); el contexto técnico, en [CLAUDE.md](CLAUDE.md).

## Correrlo

```bash
cp .env.example .env    # y edita las credenciales del superusuario
docker compose up -d --build
```

- `http://<servidor>:8093` → API y web (acceso de confianza: tailnet / LAN).
- `127.0.0.1:8094` → entrada pública para un túnel (Cloudflare Tunnel u
  otro); con el panel y el registro de cuentas cerrados.
- Panel de PocketBase: `http://<servidor>:8093/_/`.

Las cuentas de la app son usuarios normales de la colección `users` y las
crea el superusuario desde el panel (o la API). La app nunca se autentica
como superusuario.

## Pruebas

```bash
node --test tests/md.test.js
```

```bash
PB_URL=http://127.0.0.1:8093 PB_ADMIN_EMAIL=… PB_ADMIN_PASSWORD=… node tests/api-smoke.mjs
```

## Estructura

```
caddy/            proxy: compresión, caché, entradas tailnet y pública
pocketbase/       Dockerfile (PocketBase 0.39.6 fijado)
pb_migrations/    el esquema, versionado (se aplica al arrancar)
pb_hooks/         dueño, derivados, versiones y papelera
pb_public/        la web (js/md.js: Markdown → título, texto plano, etiquetas, enlaces)
tests/            tests de md.js y prueba de humo de la API
scripts/hooks/    pre-push: sintaxis y tests antes de desplegar
```
