# BakaMail 运行镜像
#
# 两个关键点：
#   1. 前端在构建阶段产出 dist，运行阶段由 BFF 直接托管
#   2. 把 maddy 的二进制复制进来，账号生命周期命令直接调用它，
#      因此不需要挂 docker socket（挂 socket 等于把主机控制权交出去）

# 基础镜像固定到具体版本和摘要：Node 24.22.1 修复了 2026-10-21 公布的 10 项安全问题（含 Brotli 解码器和 TLS 主机名校验）。
# 以后升级 Node：先在 Docker Hub 确认新版本的 node:<版本>-alpine，再同时改下面两处标签和摘要。
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

# 账号生命周期需要这三个东西，缺一不可：
#   maddy 二进制、maddy.conf 所在的 /data、可写的数据目录
COPY --from=foxcpp/maddy:0.9.5 /bin/maddy /usr/local/bin/maddy
RUN apk add --no-cache tini && mkdir -p /app/data

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server/src ./server/src
COPY shared ./shared
COPY --from=build /app/web/dist ./web/dist

# maddy CLI 需要以 root 身份写 /data（maddydata 卷属主是 root）
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8790/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/src/index.ts"]
