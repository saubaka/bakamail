/**
 * 站点 SEO：配置结构、校验、默认文案、达标评分，以及首页 <head>、robots.txt、sitemap.xml 的生成。
 * 全部是不依赖运行环境的纯函数：服务端用它生成真正输出的页面，后台页面用同一份代码实时预览和评分，
 * 所以“预览看到的”和“搜索引擎抓到的”不会出现两套逻辑。
 */

export const SEO_DEFAULT_SITE_NAME = "Baka Mail";
export const SEO_DEFAULT_TAGLINE = "自建邮局的网页端";
export const SEO_DEFAULT_OG_IMAGE = "/og-image.png";
/** 默认分享图的真实尺寸；自定义图片尺寸未知，不声明宽高。 */
export const SEO_DEFAULT_OG_SIZE = { width: 1200, height: 630 } as const;
export const SEO_DEFAULT_THEME_COLOR = "#F7F9FC";
export const SEO_REPOSITORY_URL = "https://github.com/saubaka/bakamail";

export const SEO_LIMITS = {
  siteName: 30, tagline: 40, title: 80, description: 300, keywordCount: 20, keywordLength: 20, url: 300,
} as const;

export const VERIFICATION_KEYS = ["google", "bing", "baidu", "yandex", "so360"] as const;
export type VerificationKey = (typeof VERIFICATION_KEYS)[number];
/** 各家站长平台要求的 meta 名称。 */
export const VERIFICATION_META: Record<VerificationKey, string> = {
  google: "google-site-verification",
  bing: "msvalidate.01",
  baidu: "baidu-site-verification",
  yandex: "yandex-verification",
  so360: "360-site-verification",
};
export const VERIFICATION_LABELS: Record<VerificationKey, string> = {
  google: "Google", bing: "Bing", baidu: "百度", yandex: "Yandex", so360: "360 搜索",
};

export type SeoConfig = {
  /** 站点名：浏览器标题、页面品牌、分享卡片都用它。 */
  siteName: string;
  /** 品牌旁边的一句话。留空使用默认。 */
  tagline: string;
  /** 首页标题。留空则按站点名自动生成。 */
  homeTitle: string;
  /** 首页描述。留空则按站点名自动生成。 */
  description: string;
  /** 关键词。留空则自动生成。 */
  keywords: string[];
  /** 站点的规范网址（只有协议和域名）。留空使用服务器配置的公开地址。 */
  canonicalOrigin: string;
  /** 允许搜索引擎收录首页。其他页面（登录、注册、邮箱、后台）永远不收录。 */
  indexHome: boolean;
  sitemap: boolean;
  structuredData: boolean;
  /** 分享图片：站内路径或 https 地址。留空使用默认图。 */
  ogImage: string;
  twitterCard: "summary" | "summary_large_image";
  themeColor: string;
  verification: Record<VerificationKey, string>;
};

export const defaultSeoConfig = (): SeoConfig => ({
  siteName: SEO_DEFAULT_SITE_NAME,
  tagline: "",
  homeTitle: "",
  description: "",
  keywords: [],
  canonicalOrigin: "",
  indexHome: true,
  sitemap: true,
  structuredData: true,
  ogImage: "",
  twitterCard: "summary_large_image",
  themeColor: SEO_DEFAULT_THEME_COLOR,
  verification: { google: "", bing: "", baidu: "", yandex: "", so360: "" },
});

export const defaultTitle = (siteName: string): string => `${siteName} - 自建邮局的网页邮箱`;
export const defaultDescription = (siteName: string): string =>
  `${siteName}是给自建 Maddy 邮局用的网页邮箱：凭邀请码注册，在浏览器里收发邮件、整理文件夹、搜索旧邮件，不用安装客户端，开源可自行部署。`;
export const defaultKeywords = (siteName: string): string[] => [siteName, "网页邮箱", "自建邮箱", "Maddy", "Webmail", "开源邮箱"];

/** 首页的功能介绍与常见问题：页面显示、noscript 内容和结构化数据共用这一份，保证三处一致。 */
export const INTRO_FEATURES = [
  { title: "收发和整理", text: "可以收发邮件、管理文件夹，也支持搜索、联系人和草稿。" },
  { title: "注册和登录有限制", text: "新用户需要邀请码。登录要填验证码，连续输错会被暂时限制，管理后台和普通登录分开。" },
  { title: "手机上也能用", text: "页面会按屏幕宽度调整，在手机和电脑上都能正常阅读、回复邮件。" },
] as const;
export const INTRO_FAQ = [
  { question: "我怎么开通邮箱？", answer: "本站需要邀请码才能注册。拿到管理员给你的邀请码后，到注册页填写账号名和密码就可以开通。没有邀请码的话，请先联系管理员。", link: { to: "/register", label: "用邀请码开通邮箱" } },
  { question: "忘记密码了怎么办？", answer: "在登录页点“忘记密码”，提交重置申请。管理员核对后会帮你设置新密码，网页上不能直接修改密码。", link: { to: "/password-reset", label: "申请重置密码" } },
  { question: "我的邮件安全吗？", answer: "邮件保存在站点自己的邮件服务器上，网页只通过本站的服务读取它们，浏览器不会直接连接邮件服务器。邮件正文在隔离的窗口里显示，里面的脚本不会运行。" },
] as const;

// ---------- 文字宽度 ----------

/** 汉字、全角符号按 2 计，其余按 1 计：与搜索结果里的截断位置大致对应。 */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width += code > 0xffff || /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1;
  }
  return width;
}
/** 约合多少个汉字，用于给人看的字数。 */
export const approxChars = (text: string): number => Math.round(textWidth(text) / 2);

export function truncateByWidth(text: string, maxWidth: number): string {
  if (textWidth(text) <= maxWidth) return text;
  let out = "", width = 0;
  for (const char of text) {
    const next = textWidth(char);
    if (width + next > maxWidth - 2) break;
    out += char; width += next;
  }
  return `${out.trimEnd()}…`;
}

// ---------- 校验 ----------

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
const squash = (value: string): string => value.replace(/\s+/g, " ").trim();
const codePoints = (value: string): number => [...value].length;

/** 把用逗号、顿号、分号或换行分隔的文字拆成关键词列表。 */
export function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,，、;；\n\r]+/)) {
    const word = squash(part);
    const key = word.toLowerCase();
    if (word && !seen.has(key)) { seen.add(key); out.push(word); }
  }
  return out;
}

/** 允许直接粘贴整段 <meta …> 标签，只取 content 的值。 */
export function extractVerification(value: string): string {
  const text = value.trim();
  const match = text.match(/content\s*=\s*["']([^"']*)["']/i);
  return (match ? match[1]! : text).trim();
}

const VERIFICATION_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

/** 规范网址：只保留协议 + 域名（+ 端口）。http 仅允许本机地址。 */
export function normalizeOrigin(value: string): { ok: true; origin: string } | { ok: false; message: string } {
  const text = value.trim();
  if (!text) return { ok: true, origin: "" };
  let url: URL;
  try { url = new URL(text); } catch { return { ok: false, message: "规范网址格式不对，请填写类似 https://mail.example.com 的完整地址" }; }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return { ok: false, message: "规范网址必须以 https:// 开头（本机调试可用 http://localhost）" };
  if (url.username || url.password) return { ok: false, message: "规范网址不能包含账号或密码" };
  if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return { ok: false, message: "规范网址只填协议和域名，不要带路径、参数或 #" };
  if (!url.hostname.includes(".") && !local) return { ok: false, message: "规范网址的域名看起来不完整" };
  return { ok: true, origin: url.origin };
}

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;

export function normalizeImage(value: string): { ok: true; image: string } | { ok: false; message: string } {
  const text = value.trim();
  if (!text) return { ok: true, image: "" };
  if (text.length > SEO_LIMITS.url) return { ok: false, message: `分享图片地址最长 ${SEO_LIMITS.url} 个字符` };
  if (CONTROL.test(text) || /\s/.test(text)) return { ok: false, message: "分享图片地址不能包含空格或换行" };
  if (text.startsWith("/")) {
    if (text.startsWith("//") || text.includes("..") || text.includes("?") || text.includes("#")) return { ok: false, message: "站内图片路径只能是 /文件名.png 这样的形式" };
    if (!IMAGE_EXTENSION.test(text)) return { ok: false, message: "分享图片需要是 png、jpg、webp 或 gif（社交平台不支持 svg）" };
    return { ok: true, image: text };
  }
  let url: URL;
  try { url = new URL(text); } catch { return { ok: false, message: "分享图片请填写 https:// 开头的完整地址，或以 / 开头的站内路径" }; }
  if (url.protocol !== "https:" || url.username || url.password) return { ok: false, message: "分享图片地址必须是 https:// 开头的公开地址" };
  if (!IMAGE_EXTENSION.test(url.pathname)) return { ok: false, message: "分享图片需要是 png、jpg、webp 或 gif（社交平台不支持 svg）" };
  return { ok: true, image: url.href };
}

export type SeoParse = { ok: true; config: SeoConfig } | { ok: false; message: string };

const ALLOWED_KEYS = new Set<string>(Object.keys(defaultSeoConfig()));

/** 完整校验并规范化一份提交的配置。缺失字段取默认值之外的“当前值”由调用方先合并。 */
export function parseSeoConfig(input: unknown): SeoParse {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "SEO 设置格式不对" };
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!ALLOWED_KEYS.has(key)) return { ok: false, message: `SEO 设置包含不支持的字段：${key.slice(0, 40)}` };
  const base = defaultSeoConfig();
  const text = (key: "siteName" | "tagline" | "homeTitle" | "description", label: string, limit: number, required: boolean): string | { error: string } => {
    const value = raw[key] ?? base[key];
    if (typeof value !== "string") return { error: `${label}必须是文字` };
    if (CONTROL.test(value.replace(/[\n\r\t]/g, " "))) return { error: `${label}不能包含控制字符` };
    const clean = squash(value);
    if (required && !clean) return { error: `${label}不能为空` };
    if (codePoints(clean) > limit) return { error: `${label}最多 ${limit} 个字符` };
    return clean;
  };
  const siteName = text("siteName", "站点名称", SEO_LIMITS.siteName, true);
  if (typeof siteName !== "string") return { ok: false, message: siteName.error };
  if (/[<>]/.test(siteName)) return { ok: false, message: "站点名称不能包含 < 或 >" };
  const tagline = text("tagline", "副标题", SEO_LIMITS.tagline, false);
  if (typeof tagline !== "string") return { ok: false, message: tagline.error };
  const homeTitle = text("homeTitle", "首页标题", SEO_LIMITS.title, false);
  if (typeof homeTitle !== "string") return { ok: false, message: homeTitle.error };
  const description = text("description", "首页描述", SEO_LIMITS.description, false);
  if (typeof description !== "string") return { ok: false, message: description.error };

  let keywords: string[];
  const rawKeywords = raw.keywords ?? base.keywords;
  if (!Array.isArray(rawKeywords) || rawKeywords.some((item) => typeof item !== "string")) return { ok: false, message: "关键词必须是文字列表" };
  keywords = parseKeywords((rawKeywords as string[]).join("\n"));
  if (keywords.length > SEO_LIMITS.keywordCount) return { ok: false, message: `关键词最多 ${SEO_LIMITS.keywordCount} 个` };
  if (keywords.some((word) => codePoints(word) > SEO_LIMITS.keywordLength || CONTROL.test(word) || /[<>]/.test(word))) return { ok: false, message: `每个关键词最多 ${SEO_LIMITS.keywordLength} 个字符，且不能包含 < 或 >` };

  const originRaw = raw.canonicalOrigin ?? base.canonicalOrigin;
  if (typeof originRaw !== "string") return { ok: false, message: "规范网址必须是文字" };
  const origin = normalizeOrigin(originRaw);
  if (!origin.ok) return { ok: false, message: origin.message };

  for (const key of ["indexHome", "sitemap", "structuredData"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") return { ok: false, message: `${key} 必须是开或关` };
  }
  const imageRaw = raw.ogImage ?? base.ogImage;
  if (typeof imageRaw !== "string") return { ok: false, message: "分享图片必须是文字" };
  const image = normalizeImage(imageRaw);
  if (!image.ok) return { ok: false, message: image.message };

  const card = raw.twitterCard ?? base.twitterCard;
  if (card !== "summary" && card !== "summary_large_image") return { ok: false, message: "分享卡片类型只能是 summary 或 summary_large_image" };
  const theme = raw.themeColor ?? base.themeColor;
  if (typeof theme !== "string" || !/^#[0-9a-fA-F]{6}$/.test(theme.trim())) return { ok: false, message: "主题色请填写 #RRGGBB 格式，例如 #F7F9FC" };

  const verification = { ...base.verification };
  const rawVerification = raw.verification ?? {};
  if (!rawVerification || typeof rawVerification !== "object" || Array.isArray(rawVerification)) return { ok: false, message: "站长验证格式不对" };
  for (const key of Object.keys(rawVerification as object)) {
    if (!(VERIFICATION_KEYS as readonly string[]).includes(key)) return { ok: false, message: `不支持的站长平台：${key.slice(0, 20)}` };
  }
  for (const key of VERIFICATION_KEYS) {
    const value = (rawVerification as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return { ok: false, message: `${VERIFICATION_LABELS[key]}验证码必须是文字` };
    const code = extractVerification(value);
    if (code && !VERIFICATION_PATTERN.test(code)) return { ok: false, message: `${VERIFICATION_LABELS[key]}验证码格式不对：只能是 8–100 位字母、数字、下划线或短横线，也可以直接粘贴整段 meta 标签` };
    verification[key] = code;
  }

  return {
    ok: true,
    config: {
      siteName, tagline, homeTitle, description, keywords, canonicalOrigin: origin.origin,
      indexHome: raw.indexHome === undefined ? base.indexHome : raw.indexHome as boolean,
      sitemap: raw.sitemap === undefined ? base.sitemap : raw.sitemap as boolean,
      structuredData: raw.structuredData === undefined ? base.structuredData : raw.structuredData as boolean,
      ogImage: image.image, twitterCard: card, themeColor: (theme as string).trim().toUpperCase(), verification,
    },
  };
}

// ---------- 生效值 ----------

export type SeoEffective = {
  siteName: string; tagline: string; title: string; description: string; keywords: string[];
  origin: string; indexHome: boolean; sitemap: boolean; structuredData: boolean;
  /** 分享图片的绝对地址；没有可用的网址时为空。 */
  ogImageUrl: string; ogImageIsDefault: boolean; twitterCard: SeoConfig["twitterCard"]; themeColor: string;
  verification: SeoConfig["verification"];
};

/** 把“留空 = 自动”的字段补全。origin 是服务器最终采用的规范网址（设置值或环境里的公开地址）。 */
export function resolveSeo(config: SeoConfig, origin = config.canonicalOrigin): SeoEffective {
  const siteName = config.siteName || SEO_DEFAULT_SITE_NAME;
  const image = config.ogImage || SEO_DEFAULT_OG_IMAGE;
  return {
    siteName,
    tagline: config.tagline || SEO_DEFAULT_TAGLINE,
    title: config.homeTitle || defaultTitle(siteName),
    description: config.description || defaultDescription(siteName),
    keywords: config.keywords.length ? config.keywords : defaultKeywords(siteName),
    origin,
    indexHome: config.indexHome, sitemap: config.sitemap, structuredData: config.structuredData,
    ogImageUrl: /^https:/i.test(image) ? image : origin ? `${origin}${image}` : "",
    ogImageIsDefault: !config.ogImage,
    twitterCard: config.twitterCard,
    themeColor: config.themeColor,
    verification: config.verification,
  };
}

// ---------- 达标评分 ----------

export type SeoLevel = "pass" | "warn" | "fail" | "info";
export type SeoCheck = { id: string; group: "标题与描述" | "收录与地址" | "分享与结构化" | "站长平台"; level: SeoLevel; label: string; detail: string; weight: number };
export type SeoReport = { score: number; grade: "优秀" | "良好" | "需要改进" | "不达标"; checks: SeoCheck[]; counts: Record<SeoLevel, number> };

export function evaluateSeo(config: SeoConfig, origin = config.canonicalOrigin): SeoReport {
  const eff = resolveSeo(config, origin);
  const checks: SeoCheck[] = [];
  const add = (id: string, group: SeoCheck["group"], weight: number, level: SeoLevel, label: string, detail: string) =>
    checks.push({ id, group, level, label, detail, weight });

  const nameWidth = textWidth(eff.siteName);
  add("site-name", "标题与描述", 8, nameWidth > 24 ? "warn" : "pass", "站点名称",
    nameWidth > 24 ? `约 ${approxChars(eff.siteName)} 字，偏长，标题里容易被截断；建议 12 字以内。` : `「${eff.siteName}」，长度合适。`);

  const titleWidth = textWidth(eff.title), titleChars = approxChars(eff.title);
  let titleLevel: SeoLevel = "pass", titleDetail = `约 ${titleChars} 字，长度合适（建议 8–30 字）。`;
  if (titleWidth < 12) { titleLevel = "fail"; titleDetail = `约 ${titleChars} 字，太短，说明不了页面内容；建议 8–30 字。`; }
  else if (titleWidth < 16) { titleLevel = "warn"; titleDetail = `约 ${titleChars} 字，偏短；建议 8–30 字。`; }
  else if (titleWidth > 100) { titleLevel = "fail"; titleDetail = `约 ${titleChars} 字，太长，搜索结果里会被大幅截断；建议 8–30 字。`; }
  else if (titleWidth > 60) { titleLevel = "warn"; titleDetail = `约 ${titleChars} 字，搜索结果里可能被截断；建议 8–30 字。`; }
  add("title-length", "标题与描述", 14, titleLevel, "首页标题长度", titleDetail);

  const hasName = eff.title.toLowerCase().includes(eff.siteName.toLowerCase());
  add("title-brand", "标题与描述", 6, hasName ? "pass" : "warn", "标题包含站点名称",
    hasName ? "标题里有站点名称，品牌词容易被搜到。" : "标题里没有站点名称，搜索站点名时排名会吃亏；建议把站点名放进标题。");

  const descWidth = textWidth(eff.description), descChars = approxChars(eff.description);
  let descLevel: SeoLevel = "pass", descDetail = `约 ${descChars} 字，长度合适（建议 50–80 字）。`;
  if (descWidth < 40) { descLevel = "fail"; descDetail = `约 ${descChars} 字，太短；建议 50–80 字，把站点做什么、给谁用说清楚。`; }
  else if (descWidth < 80) { descLevel = "warn"; descDetail = `约 ${descChars} 字，偏短；建议 50–80 字。`; }
  else if (descWidth > 240) { descLevel = "fail"; descDetail = `约 ${descChars} 字，太长，搜索结果会被截断；建议 50–80 字。`; }
  else if (descWidth > 170) { descLevel = "warn"; descDetail = `约 ${descChars} 字，搜索结果里可能被截断；建议 50–80 字。`; }
  add("description-length", "标题与描述", 14, descLevel, "首页描述长度", descDetail);

  const distinct = eff.description.trim().toLowerCase() !== eff.title.trim().toLowerCase();
  add("description-distinct", "标题与描述", 4, distinct ? "pass" : "fail", "描述与标题不重复",
    distinct ? "描述补充了标题之外的信息。" : "描述和标题完全一样，浪费了展示信息的机会。");

  const count = eff.keywords.length;
  const keywordLevel: SeoLevel = !config.keywords.length ? "info" : count >= 3 && count <= 8 ? "pass" : "warn";
  add("keywords", "标题与描述", 6, keywordLevel, "关键词",
    !config.keywords.length ? `已按站点名自动生成 ${count} 个。Google 不看关键词，百度、必应只作参考，不填也行。`
      : keywordLevel === "pass" ? `${count} 个，数量合适（建议 3–8 个）。` : `${count} 个；建议 3–8 个，堆太多反而显得在作弊。`);

  const origin0 = eff.origin;
  const secure = origin0.startsWith("https://");
  add("canonical", "收录与地址", 12, !origin0 ? "fail" : secure ? "pass" : "warn", "规范网址（canonical）",
    !origin0 ? "还没有规范网址：页面里不会输出 canonical，分享卡片和站点地图也生成不了。请填写，或在服务器环境里设置 PUBLIC_ORIGIN。"
      : secure ? `${origin0}，使用 HTTPS。` : `${origin0} 不是 HTTPS，主流搜索引擎更信任 HTTPS 站点。`);

  add("index-home", "收录与地址", 12, eff.indexHome ? "pass" : "fail", "允许搜索引擎收录首页",
    eff.indexHome ? "首页允许被收录；登录、注册、邮箱和后台页面始终不收录，也不会出现在站点地图里。"
      : "首页目前被设置为不收录，搜索引擎不会展示这个站点。");

  const sitemapLevel: SeoLevel = !eff.sitemap ? "warn" : !origin0 ? "warn" : "pass";
  add("sitemap", "收录与地址", 6, eff.indexHome ? sitemapLevel : "info", "站点地图与 robots.txt",
    !eff.indexHome ? "首页不收录时，robots.txt 会禁止抓取，站点地图不输出。"
      : !eff.sitemap ? "站点地图已关闭；站点只有一个首页，影响不大，但开着能帮搜索引擎更快发现。"
        : !origin0 ? "站点地图需要规范网址才能生成。" : "/sitemap.xml 和 /robots.txt 已就绪，robots.txt 里会附上站点地图地址。");

  add("structured-data", "分享与结构化", 6, eff.structuredData ? "pass" : "warn", "结构化数据（JSON-LD）",
    eff.structuredData ? "已输出网站、网页应用和常见问题的结构化数据，内容与页面一致。" : "已关闭；打开后搜索引擎更容易理解站点是什么。");

  const imageOk = Boolean(eff.ogImageUrl);
  add("og-image", "分享与结构化", 6, imageOk ? "pass" : "warn", "分享图片",
    imageOk ? (eff.ogImageIsDefault ? "使用内置分享图（1200×630）。想要更有辨识度，可换成自己的图片。" : "已设置自定义分享图片；建议 1200×630，小于 1MB。")
      : "需要规范网址才能给出完整的图片地址，社交平台才能显示预览图。");

  add("theme-color", "分享与结构化", 2, "pass", "浏览器主题色", `${eff.themeColor}，手机浏览器地址栏会使用这个颜色。`);

  const verified = VERIFICATION_KEYS.filter((key) => eff.verification[key]);
  add("verification", "站长平台", 4, verified.length ? "pass" : "info", "站长平台验证",
    verified.length ? `已填写 ${verified.map((key) => VERIFICATION_LABELS[key]).join("、")}。` : "还没有填写。不影响收录；想在站长平台查看搜索数据时，再回来填。");

  const counts: Record<SeoLevel, number> = { pass: 0, warn: 0, fail: 0, info: 0 };
  let earned = 0, total = 0;
  for (const check of checks) {
    counts[check.level]++;
    if (check.level === "info") continue;
    total += check.weight;
    earned += check.level === "pass" ? check.weight : check.level === "warn" ? check.weight / 2 : 0;
  }
  const score = total ? Math.round((earned / total) * 100) : 100;
  const grade = score >= 90 ? "优秀" : score >= 75 ? "良好" : score >= 60 ? "需要改进" : "不达标";
  return { score, grade, checks, counts };
}

// ---------- 页面输出 ----------

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 放进 <script> 里的 JSON：把能提前结束脚本或破坏页面的字符全部转义。 */
export const safeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

export function structuredData(eff: SeoEffective): unknown {
  const url = eff.origin ? `${eff.origin}/` : undefined;
  const ref = (suffix: string) => (url ? `${url}#${suffix}` : undefined);
  const strip = <T extends Record<string, unknown>>(value: T): T =>
    Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
  return {
    "@context": "https://schema.org",
    "@graph": [
      strip({ "@type": "WebSite", "@id": ref("website"), url, name: eff.siteName, description: eff.description, inLanguage: "zh-CN" }),
      strip({
        "@type": "WebApplication", "@id": ref("app"), url, name: eff.siteName, description: eff.description,
        applicationCategory: "CommunicationApplication", operatingSystem: "Any", inLanguage: "zh-CN",
        browserRequirements: "需要启用 JavaScript", isAccessibleForFree: true,
      }),
      {
        "@type": "FAQPage",
        mainEntity: INTRO_FAQ.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })),
      },
    ],
  };
}

const meta = (name: string, content: string): string => `<meta name="${name}" content="${escapeHtml(content)}" />`;
const property = (name: string, content: string): string => `<meta property="${name}" content="${escapeHtml(content)}" />`;

/** 首页完整的 SEO 头部标签（不含 <title>，标题单独返回）。 */
export function renderHomeHead(eff: SeoEffective): string {
  const lines: string[] = [];
  lines.push(meta("description", eff.description));
  if (eff.keywords.length) lines.push(meta("keywords", eff.keywords.join(",")));
  lines.push(meta("robots", eff.indexHome ? "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" : "noindex, nofollow"));
  if (eff.origin) lines.push(`<link rel="canonical" href="${escapeHtml(`${eff.origin}/`)}" />`);
  lines.push(meta("theme-color", eff.themeColor));
  lines.push(meta("application-name", eff.siteName));
  lines.push(meta("apple-mobile-web-app-title", eff.siteName));
  lines.push(meta("author", "saubaka"));
  lines.push(property("og:type", "website"));
  lines.push(property("og:site_name", eff.siteName));
  lines.push(property("og:title", eff.title));
  lines.push(property("og:description", eff.description));
  lines.push(property("og:locale", "zh_CN"));
  if (eff.origin) lines.push(property("og:url", `${eff.origin}/`));
  if (eff.ogImageUrl) {
    lines.push(property("og:image", eff.ogImageUrl));
    if (eff.ogImageIsDefault) {
      lines.push(property("og:image:type", "image/png"));
      lines.push(property("og:image:width", String(SEO_DEFAULT_OG_SIZE.width)));
      lines.push(property("og:image:height", String(SEO_DEFAULT_OG_SIZE.height)));
    }
    lines.push(property("og:image:alt", `${eff.siteName} 的标志`));
  }
  lines.push(meta("twitter:card", eff.ogImageUrl ? eff.twitterCard : "summary"));
  lines.push(meta("twitter:title", eff.title));
  lines.push(meta("twitter:description", eff.description));
  if (eff.ogImageUrl) lines.push(meta("twitter:image", eff.ogImageUrl));
  for (const key of VERIFICATION_KEYS) if (eff.verification[key]) lines.push(meta(VERIFICATION_META[key], eff.verification[key]));
  if (eff.structuredData) lines.push(`<script type="application/ld+json">${safeJson(structuredData(eff))}</script>`);
  return lines.join("\n    ");
}

/** 其他页面（登录、注册、邮箱、后台……）：不收录，只保留站点名和主题色。 */
export function renderPrivateHead(eff: SeoEffective): string {
  return [meta("robots", "noindex, nofollow"), meta("theme-color", eff.themeColor), meta("application-name", eff.siteName)].join("\n    ");
}

/** 不执行脚本的抓取工具看到的首页正文；底部的开源和版权标记是固定内容，不受 SEO 设置影响。 */
export function renderNoscript(eff: SeoEffective, year: number): string {
  const features = INTRO_FEATURES.map((item) => `<li><strong>${escapeHtml(item.title)}</strong>：${escapeHtml(item.text)}</li>`).join("");
  const faq = INTRO_FAQ.map((item) => `<dt>${escapeHtml(item.question)}</dt><dd>${escapeHtml(item.answer)}</dd>`).join("");
  return `<noscript><main><h1>${escapeHtml(eff.siteName)}</h1><p>${escapeHtml(eff.tagline)}</p><p>${escapeHtml(eff.description)}</p>`
    + `<h2>功能介绍</h2><ul>${features}</ul><h2>常见问题</h2><dl>${faq}</dl>`
    + `<p><a href="/login">登录邮箱</a> · <a href="/register">我有邀请码</a></p></main>`
    + `<footer><p><a href="${SEO_REPOSITORY_URL}" rel="noopener noreferrer">开源仓库</a></p><p>© ${year} saubaka. BakaMail.</p><p>邮件服务基于 Maddy，第三方项目版权归原作者所有。</p></footer></noscript>`;
}

/** 前端启动时读取的站点信息（写在页面里，首屏就是正确的站点名）。 */
export type SiteInfo = { siteName: string; tagline: string; title: string; description: string };
export const siteInfoOf = (eff: SeoEffective): SiteInfo => ({ siteName: eff.siteName, tagline: eff.tagline, title: eff.title, description: eff.description });

/**
 * 登录、注册、邮箱和后台页面不在这里禁止抓取：它们靠 noindex 标记（页面头和响应头都有）排除出搜索结果，
 * 如果在 robots.txt 里禁止抓取，搜索引擎看不到 noindex，反而可能把网址本身收进去。这里也不会写出后台入口路径。
 */
export function renderRobotsTxt(eff: SeoEffective): string {
  if (!eff.indexHome) return "User-agent: *\nDisallow: /\n";
  // 只写需要禁止的：默认就允许抓取，不写 Allow，免得按书写顺序匹配的解析器把后面的 Disallow 判成无效。
  const lines = ["User-agent: *", "Disallow: /api/"];
  if (eff.sitemap && eff.origin) lines.push("", `Sitemap: ${eff.origin}/sitemap.xml`);
  return `${lines.join("\n")}\n`;
}

const xml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** 站点只有一个值得收录的页面。没有规范网址或不允许收录时返回 null（调用方回 404）。 */
export function renderSitemapXml(eff: SeoEffective, lastModified: string): string | null {
  if (!eff.indexHome || !eff.sitemap || !eff.origin) return null;
  const lastmod = /^\d{4}-\d{2}-\d{2}/.test(lastModified) ? `<lastmod>${lastModified.slice(0, 10)}</lastmod>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${xml(`${eff.origin}/`)}</loc>${lastmod}<changefreq>monthly</changefreq><priority>1.0</priority></url>\n</urlset>\n`;
}
