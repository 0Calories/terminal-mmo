# Server image for Railway (ADR 0009). The official Bun image gives a controlled
# runtime with no Node toolchain — sidestepping Nixpacks' Bun provider, which
# pulls in an EOL Node and fails to build. The shared World is stateless
# (ephemeral alpha), so this is a plain single-process container.
FROM oven/bun:1

WORKDIR /app

# Install workspace deps from a clean lockfile. node_modules is .dockerignore'd so
# the container resolves Linux-native packages (e.g. @opentui/core) itself rather
# than inheriting the host's.
COPY . .
RUN bun install --frozen-lockfile

# Railway injects PORT; the server also reads it (falls back to 8080 locally).
EXPOSE 8080
CMD ["bun", "run", "packages/server/src/index.ts"]
