FROM node:22-slim

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY patches/ patches/
COPY packages/ packages/
COPY services/ services/

RUN pnpm install --frozen-lockfile --filter @atrib/integration...
RUN pnpm --filter @atrib/mcp build
RUN pnpm --filter @atrib/verify build
RUN pnpm --filter @atrib/agent build

EXPOSE 8080

ENV PORT=8080

CMD ["pnpm", "--filter", "@atrib/integration", "google-evidence-runtime"]
