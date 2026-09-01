# syntax=docker/dockerfile:1

############################
# Base
############################
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Corepack-Cache an einen für alle Nutzer lesbaren Ort legen und die in
# package.json gepinnte pnpm-Version schon im Build installieren. Sonst
# lädt Corepack sie beim ersten Containerstart als Nutzer „node" aus dem
# Netz nach — der Start hinge damit an einer Internetverbindung.
ENV COREPACK_HOME=/opt/corepack
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack install --global pnpm@11.13.1 \
  && chmod -R a+rX /opt/corepack
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
RUN pnpm install --frozen-lockfile

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
COPY --from=build --chown=node:node /app /app
# Upload- und Datenverzeichnis dem unprivilegierten Nutzer übergeben;
# die benannten Volumes erben diese Eigentümerschaft bei Erst-Erstellung.
# /app/data hält u. a. das automatisch erzeugte APP_SECRET.
RUN mkdir -p /app/uploads /app/data && chown node:node /app/uploads /app/data
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 3000 3001
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "pnpm --filter @dokunc/db migrate:deploy && pnpm start"]
