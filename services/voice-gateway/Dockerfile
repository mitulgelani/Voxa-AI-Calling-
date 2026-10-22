# VaniDial voice gateway. Long-running: holds carrier media WebSockets, so it cannot run on serverless.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S vd && adduser -S vd -G vd
COPY --from=build --chown=vd:vd /app/node_modules ./node_modules
COPY --from=build --chown=vd:vd /app/dist ./dist
COPY --chown=vd:vd package.json ./
USER vd
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/index.js"]
