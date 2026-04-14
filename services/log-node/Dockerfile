FROM node:20-slim AS base
RUN corepack enable

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy only the packages we need (mcp + log-node)
COPY packages/mcp/ packages/mcp/
COPY services/log-node/ services/log-node/

RUN pnpm install --frozen-lockfile --filter @atrib/log-node...
RUN pnpm --filter @atrib/mcp build
RUN pnpm --filter @atrib/log-node build

EXPOSE 3100

ENV PORT=3100
ENV HOST=0.0.0.0

CMD ["node", "services/log-node/dist/main.js"]
