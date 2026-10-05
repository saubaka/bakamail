import { existsSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { config, projectRoot } from "./config.ts";
import { ensureBootstrapAdmin } from "./admin/accounts.ts";
import { authRouter } from "./routes/auth.ts";
import { mailRouter } from "./routes/mail.ts";
import { adminRouter } from "./routes/admin.ts";
import { uiConfigRouter } from "./routes/appearance.ts";
import { fail, ok, requestId, RequestBodyError, sendJson } from "./http/kit.ts";
import { isRetiredAdminPath } from "../../shared/adminPaths.ts";
import { isTrustedProxyPeer } from "./security/identity.ts";
import { requireSameOrigin } from "./security/origin.ts";
import { SecurityBudgetError, rejectBudget } from "./security/abuse.ts";
import { prepareInstallation, retiredInstallationPath, InstallationError } from "./admin/installation.ts";
import { installationRouter, entrySettingsRouter } from "./routes/installation.ts";

export type AppOptions = {
  /** 测试时关闭引导管理员创建，避免污染断言 */
  bootstrapAdmin?: boolean;
  log?: (message: string) => void;
};

/**
 * 判断一个路径是不是「静态资源」而不是前端路由。
 * 缺失的静态资源必须 404，绝不能回落到 index.html——否则浏览器会拿到
 * 200 + HTML 当作脚本执行，页面直接空白且没有任何重试信号。
 */
export function looksLikeAssetPath(path: string): boolean {
  return /\.[a-z0-9]{1,8}$/i.test(path);
}

export function createApp(options: AppOptions = {}): express.Express {
  const log = options.log ?? ((message: string) => console.log(`[bakamail] ${message}`));
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", isTrustedProxyPeer);

  app.use((request, response, next) => {
    response.setHeader("x-request-id", requestId(request));
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "same-origin");
    response.setHeader("x-frame-options", "DENY");
    // XHR cannot opt out of redirects; keep scripted connections on this origin at the browser boundary.
    response.setHeader("content-security-policy", "connect-src 'self'");
    next();
  });

  /*
   * 刻意不使用 express.json()：所有路由统一走 http/kit.ts 的 readJson()，
   * 由它读取原始流并限制体积。
   */

  app.get("/api/health", (_request, response) => {
    ok(response, {
      status: "ok",
    });
  });

  app.use(["/api/auth", "/api/admin/auth/login", "/api/admin/human-check"], requireSameOrigin);
  app.use("/api/auth", authRouter);
  app.use("/api", installationRouter);
  app.use("/api/admin", entrySettingsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api", uiConfigRouter);
  app.use("/api", mailRouter);

  app.use("/api", (_request, response) => {
    fail(response, 404, "接口不存在");
  });

  // Retired page URLs must never reach static files or the generic SPA index fallback.
  app.use((request, response, next) => {
    if (!isRetiredAdminPath(request.originalUrl) && !retiredInstallationPath(request.originalUrl)) { next(); return; }
    response.status(404).setHeader("cache-control", "no-store");
    response.type("text/plain").send("Not Found");
  });

  const webDist = join(projectRoot, "web", "dist");
  if (existsSync(webDist)) {
    // 带内容哈希的资源可以长期强缓存
    app.use(
      "/assets",
      express.static(join(webDist, "assets"), {
        fallthrough: true,
        maxAge: "365d",
        immutable: true,
      }),
    );
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));

    /*
     * 只有「看起来像前端路由」的路径才回落到 index.html。
     *
     * 这里踩过一个坑：以前是无条件回落，于是请求任何不存在的 .js/.css 都会
     * 拿到 200 + HTML。浏览器把这段 HTML 当脚本解析必然报错，页面直接空白，
     * 而且 200 意味着没有任何信号提示它该重新拉取。现在缺失静态资源一律 404。
     */
    app.get(/^\/(?!api\/).*/, (request, response, next) => {
      if (looksLikeAssetPath(request.path)) {
        next();
        return;
      }
      response.setHeader("cache-control", "no-cache, must-revalidate");
      response.sendFile(join(webDist, "index.html"));
    });

    // 走到这里的都是缺失的静态资源：返回不可缓存的 404
    app.use((request, response, next) => {
      if (request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.status(404);
      response.setHeader("cache-control", "no-store");
      response.type("text/plain");
      response.send("Not Found");
    });
  }

  app.use(
    (
      error: Error,
      request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (response.headersSent) return;
      if (error instanceof InstallationError) { fail(response, error.status, error.message); return; }
      if (error instanceof SecurityBudgetError) { rejectBudget(response, error.code, error.seconds); return; }
      if (error instanceof RequestBodyError) {
        if (error.closeConnection) response.setHeader("connection", "close");
        sendJson(response, error.status, { ok: false, data: null, error: error.message, code: error.code });
        return;
      }
      // Library exception messages/responseText/stacks may contain credentials or mail data.
      // Log only a bounded category and the same ID that the caller receives.
      const name = error instanceof Error && /^[a-zA-Z0-9._-]{1,64}$/.test(error.name)
        ? error.name : "UnknownError";
      const code = (error as { code?: unknown } | null)?.code;
      const safeCode = typeof code === "string" && /^[a-zA-Z0-9._-]{1,64}$/.test(code) ? code : "unclassified";
      log(`未处理异常: ${name} code=${safeCode} request-id=${requestId(request)}`);
      fail(response, 500, "服务器内部错误");
    },
  );

  if (options.bootstrapAdmin !== false) {
    ensureBootstrapAdmin(log);
  }
  prepareInstallation(log);
  return app;
}
