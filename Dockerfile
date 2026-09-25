# syntax=docker/dockerfile:1

############################
# Base
############################
# Debian 13 (trixie) statt 12 (bookworm): bookworm bekommt seit
# 2026-07-12 Korrekturen nur noch ueber Debian LTS, und openssl und
# ca-certificates unten kommen per apt genau aus diesem Release. Alle
# weiteren Stufen bauen auf dieser auf, eine Zeile stellt also alle um.
# Unter trixie geprueft: beide Paketnamen gelten unveraendert (OpenSSL
# 3.5, libssl3t64 steckt schon im Basis-Image), und die Schema-Engine der
# Prisma-CLI (migrate deploy im CMD) waehlt ihr Binary nach der
# OpenSSL-Hauptversion — wie unter bookworm debian-openssl-3.0.x.
FROM node:26-trixie-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# pnpm fest im Image installieren, in der in package.json gepinnten
# Version. Corepack ist hier kein Weg: node:26 bringt es nicht mehr mit
# (`corepack: not found`). Ein Nachladen zur Laufzeit wäre ohnehin
# unerwünscht — der Containerstart hinge sonst am Netz.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.13.1 \
  && npm cache clean --force
WORKDIR /app

############################
# Dependencies
############################
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/collab/package.json apps/collab/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/editor/package.json packages/editor/package.json
COPY packages/mail/package.json packages/mail/package.json
# Ohne --prod, weil diese Stufe die Build-Stufe speist: `next build`
# braucht typescript, tailwind und die @types. Das Laufzeit-Image nimmt
# seinen Abhängigkeitsbaum nicht von hier, sondern aus deps-prod.
RUN pnpm install --frozen-lockfile

############################
# Dependencies (nur Laufzeit)
############################
FROM base AS deps-prod
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/collab/package.json apps/collab/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/editor/package.json packages/editor/package.json
COPY packages/mail/package.json packages/mail/package.json
# Derselbe Installationsstand ohne devDependencies. Die runner-Stufe nahm
# frueher das GESAMTE /app aus dem Build und trug damit vitest,
# @playwright/test und typescript mit, die sie nie ausfuehrt — ein
# Image-Scan meldete deren Advisories.
#
# Was dabei zur Laufzeit gebraucht wird, MUSS unter dependencies stehen,
# sonst faellt es hier weg und der Container startet nicht mehr. Betroffen
# waren vier Pakete: tsx (der Collab-Server laeuft damit direkt aus den
# .ts-Quellen) und die Prisma-CLI (der Containerstart setzt damit die
# Migrationen, s. CMD) standen schon richtig; concurrently (Wurzel, das
# `pnpm start` im CMD startet beide Server damit) und dotenv in
# packages/db (prisma.config.ts liest es beim migrate:deploy) standen
# unter devDependencies und sind jetzt verschoben.
RUN pnpm install --frozen-lockfile --prod

############################
# Build
############################
FROM base AS build
# Das GESAMTE /app aus der deps-Stage übernehmen. pnpm legt pro
# Workspace-Paket ein eigenes node_modules an; einzeln aufgezählte
# Kopien (packages/editor fehlte) gehen beim nächsten neuen Paket still
# kaputt — hier bleibt der Installationsstand vollständig.
COPY --from=deps /app /app
COPY . .
# Leer lassen: dann leitet die App den Collab-Endpunkt zur Laufzeit aus
# der aufgerufenen Adresse ab (…/collab). So läuft dasselbe Image unter
# localhost wie unter jeder eigenen Domain — ohne Rebuild.
ARG NEXT_PUBLIC_COLLAB_URL=
ENV NEXT_PUBLIC_COLLAB_URL=$NEXT_PUBLIC_COLLAB_URL
# `prisma generate` liest die Datasource-URL aus der Config und bricht
# ohne sie ab. Für die reine Client-Generierung wird nicht verbunden —
# der Platzhalter bleibt im Image ohne Wirkung (zur Laufzeit setzt
# Compose die echte DATABASE_URL).
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
RUN pnpm --filter @dokunc/db generate \
  && pnpm --filter @dokunc/web build

############################
# Runner (non-root)
############################
FROM base AS runner
ENV NODE_ENV=production
# Reihenfolge ist Absicht: erst der schlanke Abhaengigkeitsbaum, dann die
# Quellen (der Collab-Server laeuft aus .ts, next start liest die Config),
# zuletzt das, was nur im Build entsteht — Next-Ausgabe und der erzeugte
# Prisma-Client. Der Build-Stand selbst kommt NICHT komplett mit, sonst
# waere die deps-prod-Stufe wirkungslos.
COPY --from=deps-prod --chown=node:node /app /app
COPY --chown=node:node . .
COPY --from=build --chown=node:node /app/apps/web/.next /app/apps/web/.next
COPY --from=build --chown=node:node /app/packages/db/src/generated /app/packages/db/src/generated
# Upload- und Datenverzeichnis dem unprivilegierten Nutzer übergeben;
# die benannten Volumes erben diese Eigentümerschaft bei Erst-Erstellung.
# /app/data hält u. a. das automatisch erzeugte APP_SECRET.
RUN mkdir -p /app/uploads /app/data && chown node:node /app/uploads /app/data
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 3000 3001
ENTRYPOINT ["docker-entrypoint.sh"]
# `exec` am Ende: der Server wird PID 1 und bekommt SIGTERM direkt —
# sonst wartet Docker beim Stoppen bis zum Hard-Kill (10 s) und der
# Collab-Server verliert womöglich noch nicht gespeicherte Änderungen.
CMD ["sh", "-c", "pnpm --filter @dokunc/db migrate:deploy && exec pnpm start"]
