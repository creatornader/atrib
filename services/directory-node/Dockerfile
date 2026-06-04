FROM node:20-slim AS base
RUN corepack enable

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY patches/ patches/

# Copy packages the directory service depends on
# (mcp + directory + directory-node). The @atrib/directory package
# bundles the AKD WASM artifacts inline under packages/directory/wasm/,
# so no separate Rust build is needed at image-build time.
COPY packages/mcp/ packages/mcp/
COPY packages/directory/ packages/directory/
COPY services/directory-node/ services/directory-node/

RUN pnpm install --frozen-lockfile --filter @atrib/directory-node...
RUN pnpm --filter @atrib/mcp build
RUN pnpm --filter @atrib/directory build
RUN pnpm --filter @atrib/directory-node build

EXPOSE 3300

ENV PORT=3300
ENV HOST=0.0.0.0

CMD ["node", "services/directory-node/dist/main.js"]
