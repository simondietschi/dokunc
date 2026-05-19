# syntax=docker/dockerfile:1

############################
# Base
############################
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
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
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/collab/node_modules ./apps/collab/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY . .
ARG NEXT_PUBLIC_COLLAB_URL=wss://localhost/collab
ENV NEXT_PUBLIC_COLLAB_URL=$NEXT_PUBLIC_COLLAB_URL
RUN pnpm --filter @dokunc/db generate \
  && pnpm --filter @dokunc/web build

############################
# Runner (non-root)
############################
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
# Upload-Zielverzeichnis dem unprivilegierten Nutzer übergeben; das
# benannte Volume erbt diese Eigentümerschaft bei Erst-Erstellung.
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3000 3001
CMD ["sh", "-c", "pnpm --filter @dokunc/db migrate:deploy && pnpm start"]
