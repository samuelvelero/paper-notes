# Paper Notes

**Minimal, self-hosted notes that work on every device you own.**

> **En español:** Paper Notes es una app de notas minimalista que corre en tu
> propio servidor. Igual que Jellyfin hace con tu música y tus películas, aquí
> tus notas viven en tu casa y las abres desde cualquier aparato: iPhone,
> Android, una PC con Windows o una Mac. Sin cuentas de terceros, sin
> suscripciones, sin vueltas: abres y escribes.

---

## The idea

Most good note apps lock you into one ecosystem. Apple Notes is great until
you also use a Windows PC; Google Keep is fine until you'd rather your notes
didn't live on someone else's servers.

Paper Notes borrows one idea from [Jellyfin](https://jellyfin.org): **you run
the server, every device is just a client.** That's where the similarity
ends. Jellyfin streams media; Paper Notes is a quiet place to write things
down. No AI writing assistant, no databases-inside-pages, no workspace to
configure. Open it, type, close it.

- **Any device.** It's an installable web app (PWA): add it to the home
  screen on iPhone or Android, or install it from Chrome/Edge on Windows,
  macOS and Linux.
- **Works offline.** Notes live in the browser (IndexedDB) and sync when the
  connection comes back. Edits from two devices don't silently overwrite each
  other: the losing version is kept in the history.
- **Clean writing.** A rich editor (ProseMirror) that stores plain
  **Markdown**. Type `# `, `- `, `[] `, `> ` or `**bold**` and it formats
  as you go. Headings, to-do lists, quotes, code, images, `#tags` and
  `[[links between notes]]`.
- **Folders, pins, trash, version history.** Drag a note onto a folder to
  move it; right-click anywhere for the app's own menu.
- **Share a note read-only** with a link (`/shared/<token>`) that anyone can
  open without an account, and revoke it any time.
- **Fast search.** Instant local search as you type, plus an optional search
  service with typo tolerance and semantic ("search by meaning") results.
- **Your data, plain and portable.** Every note is a Markdown string in
  SQLite. Export everything as JSON from Settings. Back up one folder.
- **Optional MCP connector** so Claude can search, read and append to your
  notes (it never deletes anything).

The interface is in Spanish for now.

## Stack

No framework, no build step for the app.

| Piece | What it does |
|---|---|
| [PocketBase](https://pocketbase.io) 0.39 | Auth, REST API, realtime (SSE), SQLite; also serves the web app |
| `pb_hooks/` (JS) | Ownership, derived fields (title, plain text, tags, links), versions, conflicts, trash, shared notes |
| `pb_public/` | The web app: vanilla JS, IndexedDB + sync queue, ProseMirror editor, service worker |
| [Caddy](https://caddyserver.com) | Compression and caching; a trusted entry (LAN/VPN) and a locked-down public one for a tunnel |
| `buscador/` (Python, optional) | Search: SQLite FTS5 (words + trigrams) + vectors with `sqlite-vec`, fused with RRF |
| `mcp/` (Node, optional) | MCP server for Claude, zero dependencies |
| `importers/` | iCloud Notes importer (text, folders, images and drawings) |

## Run it

You need a machine with Docker (a home server, a NAS, a small VPS).

```bash
git clone https://github.com/samuelvelero/paper-notes.git
cd paper-notes
cp .env.example .env      # set the admin email/password and the tokens
docker compose up -d --build
```

- `http://<server>:8093` → the app and API (meant for your LAN or a VPN such
  as Tailscale).
- `127.0.0.1:8094` → the public entry, for a tunnel (Cloudflare Tunnel or
  similar). The admin panel and sign-ups are closed there.
- Admin panel: `http://<server>:8093/_/`.

Accounts are created by the admin (public sign-up is off): create a user in
the `users` collection from the panel, then log in to the app with it.

To publish shared notes under your own domain, change `PUBLIC_ORIGIN` in
`pb_public/js/actions.js`.

### Local development (no Docker)

```bash
pocketbase serve --http=127.0.0.1:8790 --dir ./pb_data --publicDir pb_public --hooksDir pb_hooks --migrationsDir pb_migrations
```

## Tests

```bash
node --test tests/*.test.js
PB_URL=http://127.0.0.1:8790 PB_ADMIN_EMAIL=… PB_ADMIN_PASSWORD=… node tests/api-smoke.mjs
```

The smoke tests create throwaway users, check ownership, isolation between
users, versions, conflicts, folders, trash and shared links, then clean up.

## Layout

```
caddy/            reverse proxy: compression, cache, private + public entries
pocketbase/       Dockerfile (PocketBase pinned)
pb_migrations/    the schema, versioned (applied on start)
pb_hooks/         server logic: owner, derived fields, versions, trash, sharing
pb_public/        the web app (PWA)
buscador/         optional search service
mcp/              optional MCP server for Claude
importers/        iCloud Notes importer
docs/             UI notes
tests/            unit tests and API smoke tests
scripts/          vendoring ProseMirror, icons, pre-push hook
```

[PLAN.md](PLAN.md) and [CLAUDE.md](CLAUDE.md) are the (Spanish) design notes
the project was built from.

## License

[MIT](LICENSE). Bundled third-party code keeps its own license: ProseMirror
(MIT, `pb_public/js/prosemirror-LICENSE.txt`), morphdom (MIT, `pb_public/js/morphdom-LICENSE.txt`) and the Geist
font (SIL OFL, `pb_public/fonts/geist-OFL.txt`).
