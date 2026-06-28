FROM node:22-slim

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY patches/ patches/
COPY packages/ packages/

# This hosted demo does not use local Playwright browsers. Skipping package
# scripts avoids browser-use downloading Chromium during the image build; tsx
# still needs esbuild's binary, so rebuild that one package explicitly.
RUN pnpm install --frozen-lockfile --filter @atrib/integration... --ignore-scripts
RUN pnpm rebuild esbuild
RUN pnpm --filter @atrib/mcp build
RUN pnpm --filter @atrib/mcp-wrap build

EXPOSE 8080

ENV PORT=8080
ENV HOST=0.0.0.0

CMD ["node", "--import", "tsx", "packages/integration/examples/browserbase-stagehand/live-demo/server.ts"]
