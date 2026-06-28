# syntax=docker/dockerfile:1.7

# ---- build stage ----------------------------------------------------------
# Compile the client (Vite) and bundle the server (esbuild via script/build.ts).
FROM node:20-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 has a native build step. Need build-essential + python.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Install full deps (dev included) — vite, tsx, esbuild are needed for the build.
RUN npm ci --include=dev

COPY . .
RUN npm run build

# ---- runtime stage --------------------------------------------------------
# Tiny image with only the bundled server + the production node_modules
# that ship native binaries (better-sqlite3).
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Reinstall production-only deps so we get a clean prebuilt better-sqlite3
# without the dev toolchain bloating the image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && apt-get purge -y --auto-remove build-essential python3 \
 && rm -rf /root/.npm

# Bring in the built artifacts and the catalog JSONs the server reads at boot.
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
# Seed dir: one-time DB snapshot + boot wrapper that restores it on first boot.
# After the persistent disk has data, the wrapper skips the restore. Once the
# user confirms data is live on the disk, remove the seed bundle in a follow-up
# deploy to slim the image back down.
COPY --from=build /app/seed ./seed
RUN chmod +x /app/seed/boot.sh

# Persistent disk gets mounted here by Render. data.db lives inside it so it
# survives deploys/restarts. App reads DB_PATH at boot.
ENV DB_PATH=/var/data/data.db
EXPOSE 5000

CMD ["/app/seed/boot.sh"]
