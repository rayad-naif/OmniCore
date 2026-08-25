FROM node:24-bookworm-slim AS base

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN chown -R node:node /app
USER node

FROM base AS api

RUN pnpm --filter @workspace/api-server run build
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]

FROM base AS dashboard

ARG VITE_API_URL=http://localhost:8080/api
ARG VITE_PADDLE_CLIENT_TOKEN
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_PADDLE_CLIENT_TOKEN=${VITE_PADDLE_CLIENT_TOKEN}
RUN pnpm --filter @workspace/dashboard run build
ENV PORT=5173
EXPOSE 5173
CMD ["pnpm", "--filter", "@workspace/dashboard", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]