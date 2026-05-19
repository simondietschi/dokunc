# dokunc

Selbst gehostetes, kollaboratives Team-Wiki — ein von [Docmost](https://docmost.com)
inspirierter Klon. Next.js-Fullstack mit Echtzeit-Co-Editing (Yjs/CRDT).

Architektur & Designentscheidungen: siehe [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Features (MVP)

- Auth & Benutzer (Registrierung, Login, Session)
- Spaces mit Rollen/Berechtigungen (OWNER/ADMIN/MEMBER/VIEWER)
- Verschachtelter Seitenbaum + Rich-Editor (Slash-Menü „/", Tabellen,
  Aufgabenlisten, Bilder, Callouts, Mermaid-Diagramme, YouTube-Embeds)
- Echtzeit-Kollaboration mit Live-Cursorn (Yjs + Hocuspocus)
- Postgres-Volltextsuche
- Versionsverlauf + Wiederherstellen

## Stack

Next.js 16 · React 19 · TypeScript · Prisma 7 (+ pg-Adapter) · PostgreSQL 16 ·
Redis · TipTap 3 · Yjs · Hocuspocus 4 · Tailwind CSS 4 · Node 26 · pnpm.

## Schnellstart mit Docker (empfohlen)

Es muss nur Docker laufen — alles andere startet aus den Containern:

```bash
docker compose up --build
```

Danach:

- App: <http://localhost:3000>
- Collab-WebSocket: ws://localhost:3001

Die Datenbank-Migrationen laufen beim Start automatisch. Daten liegen in den
Docker-Volumes `db_data` und `redis_data`.

Konfiguration optional über Umgebungsvariablen (siehe `docker-compose.yml`),
mindestens `APP_SECRET` in Produktion setzen.

## Lokale Entwicklung (ohne Docker)

Voraussetzungen: Node 26 (`.nvmrc`), pnpm, lokal laufendes PostgreSQL 16 + Redis.

```bash
nvm use                 # Node 26
pnpm install
cp .env.example .env     # Werte anpassen
pnpm db:migrate          # Schema + Migrationen
pnpm dev                 # web :3000 + collab :3001
```

## Projektstruktur

```
apps/web      Next.js (UI, Auth, API, Editor)
apps/collab   Hocuspocus WebSocket-Server (Yjs-Persistenz)
packages/db   Prisma-Schema + generierter Client (geteilt)
packages/editor  Geteilte TipTap-Extensions
```
