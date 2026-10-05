# BakaMail source-only repository

This directory contains source, tests, dependency declarations/lockfile and placeholder configuration. Never commit `.env`, real secrets, databases/sidecars, mail/account data, logs, dependency directories or compiled output.

## 版本号与 GitHub 提交规范（强制）

- 每轮实际更改都递增版本并记录，同一轮多个文件共用一个版本；纯查看不升版。采用 `X.Y.Z`：修复/样式/测试/文档递增修订号，兼容新功能递增次版本号，不兼容更改递增主版本号，不重复或倒退。
- 根 `package.json` 为版本事实源；保持 `server/package.json`、`web/package.json` 和 `package-lock.json` 中项目版本一致，不改第三方依赖版本。根 `CHANGELOG.md` 顶部记录版本、日期及本轮实际变更，使用简体中文精简条列。
- 获用户明确提交授权后，GitHub Desktop Summary / commit 标题仅填写 `vX.Y.Z`，Description / commit 正文用 `- ` 开头的简体中文条列概括更改。每次正式提交使用独立版本号，不改写已提交历史。
- 用户另行授权 Release 时，标题/标签使用同一版本号，说明也用简体中文条列；不改仓库/分支名称，不自动创建标签或 Release。
- 提交前校验版本、变更记录、差异与镜像，提交后确认实际标题/正文和推送结果。没有成功推送证据，不宣称 GitHub 已更新。本规则不授权自动提交/推送/部署。

## Editing and verification

- If this directory is the `bakagit/` child of the original development project, edit the parent project instead. Run `npm run sync:bakagit` and `npm run check:bakagit` there after every change. Do not install dependencies inside the mirror or edit its manifest manually.
- After EVERY change in that parent project, synchronize and check before handoff; this is an agent workflow requirement, not a background watcher.
- For a standalone clone, work in that checkout normally. Install with `npm ci`; verify using `npm run typecheck`, `npm test`, `npm run build`, `npm run check`. The original-parent mirror commands are not required for standalone development.
- Browser requests must use same-origin `/api/*`; only the BFF communicates with Maddy. Preserve authentication, permission checks, CSRF, CAPTCHA and anti-abuse protections.
- Preserve the immutable `web/src/styles/vendor` CSS snapshots and their hashes. Use incremental theme CSS for changes; keep pale-blue solid outlines, no solid blue selection blocks, reduced-motion and keyboard/focus semantics.
- Mail HTML is untrusted. Never loosen the opaque sandbox to allow same-origin or arbitrary scripts/media. Keep confirmation dialogs for destructive actions.
- Do not force whole-page reloads, discard drafts or clear real-user caches. The Vite configuration retains old hashed assets for open tabs.
- Use isolated fixtures/temporary databases for tests, not real accounts or mailboxes. Do not deploy, commit, push or mutate remote resources unless explicitly requested. GitHub login/verification remains a human step.
- No license has been selected; do not invent a license grant.
