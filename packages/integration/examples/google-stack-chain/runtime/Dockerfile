FROM node:22-slim

ENV UV_LINK_MODE=copy

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python-is-python3 \
    python3 \
    python3-pip \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --break-system-packages uv google-adk==2.3.0 cryptography

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY patches/ patches/
COPY packages/ packages/
COPY services/ services/

RUN pnpm install --frozen-lockfile --filter @atrib/integration...
RUN pnpm --filter @atrib/mcp build
RUN pnpm --filter @atrib/directory build
RUN pnpm --filter @atrib/log-node build
RUN pnpm --filter @atrib/verify build
RUN pnpm --filter @atrib/agent build
RUN python3 -c "import google.adk, cryptography"

EXPOSE 8080

ENV PORT=8080
ENV ATRIB_GOOGLE_ADK_PYTHON_DIRECT=1
ENV ATRIB_GOOGLE_ADK_PYTHON_WORKER=1

CMD ["pnpm", "--filter", "@atrib/integration", "google-evidence-runtime"]
