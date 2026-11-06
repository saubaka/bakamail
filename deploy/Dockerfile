FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
 && sh scripts/verify-css-parity.sh \
 && sh scripts/verify-no-protocol-leak.sh

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=foxcpp/maddy:0.9.5 /bin/maddy /usr/local/bin/maddy
RUN apk add --no-cache tini && mkdir -p /app/data

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server/src ./server/src
COPY shared ./shared
COPY --from=build /app/web/dist ./web/dist

EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8790/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/src/index.ts"]
