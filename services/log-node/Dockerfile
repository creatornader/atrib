FROM node:20-slim AS base
RUN corepack enable

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy only the packages we need (mcp + directory + log-node).
# @atrib/directory is needed at runtime for the self-claim publish on boot
# (signClaim helper). Its WASM bridge artifacts ship inside
# packages/directory/wasm/ and load via dynamic import.
COPY packages/mcp/ packages/mcp/
COPY packages/directory/ packages/directory/
COPY services/log-node/ services/log-node/

# D054: bundle the public-explorer HTML so log-node can serve it at /dashboard.
COPY apps/dashboard/ apps/dashboard/

RUN pnpm install --frozen-lockfile --filter @atrib/log-node...
RUN pnpm --filter @atrib/mcp build
RUN pnpm --filter @atrib/directory build
RUN pnpm --filter @atrib/log-node build

EXPOSE 3100

ENV PORT=3100
ENV HOST=0.0.0.0

CMD ["node", "services/log-node/dist/main.js"]
