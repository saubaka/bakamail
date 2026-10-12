import assert from "node:assert/strict";
import test from "node:test";
import {
  INTRO_FAQ, SEO_REPOSITORY_URL, VERIFICATION_KEYS, approxChars, defaultDescription, defaultSeoConfig, defaultTitle, escapeHtml,
  evaluateSeo, extractVerification, normalizeImage, normalizeOrigin, parseKeywords, parseSeoConfig, renderHomeHead, renderNoscript,
  renderPrivateHead, renderRobotsTxt, renderSitemapXml, resolveSeo, safeJson, structuredData, textWidth, truncateByWidth,
  type SeoConfig,
} from "../../shared/seo.ts";

const ORIGIN = "https://mail.example.com";
const config = (patch: Partial<SeoConfig> = {}): SeoConfig => ({ ...defaultSeoConfig(), ...patch });
const parsed = (patch: Record<string, unknown>) => parseSeoConfig({ ...defaultSeoConfig(), ...patch });
const level = (cfg: SeoConfig, id: string, origin = ORIGIN) => evaluateSeo(cfg, origin).checks.find((check) => check.id === id)!.level;

test("文字宽度：汉字和全角符号算 2，其余算 1；约合字数按汉字折算", () => {
  assert.equal(textWidth("abc"), 3);
  assert.equal(textWidth("邮箱"), 4);
  assert.equal(textWidth("Baka 邮局，"), 4 + 1 + 4 + 2);
  assert.equal(approxChars("自建邮局的网页邮箱"), 9);
  assert.equal(truncateByWidth("短", 10), "短");
  const cut = truncateByWidth("一二三四五六七八九十", 10);
  assert.ok(cut.endsWith("…") && textWidth(cut) <= 10, cut);
});

test("默认配置达标：有规范网址时得分 100、没有任何未达标项；站点名默认 Baka Mail", () => {
  const defaults = defaultSeoConfig();
  assert.equal(defaults.siteName, "Baka Mail");
  assert.equal(defaults.indexHome, true);
  const report = evaluateSeo(defaults, ORIGIN);
  assert.equal(report.score, 100);
  assert.equal(report.grade, "优秀");
  assert.equal(report.counts.fail, 0);
  assert.equal(report.counts.warn, 0);
  const eff = resolveSeo(defaults, ORIGIN);
  assert.equal(eff.title, "Baka Mail - 自建邮局的网页邮箱");
  assert.ok(eff.description.startsWith("Baka Mail是给自建 Maddy 邮局用的网页邮箱"));
  assert.equal(eff.tagline, "自建邮局的网页端");
  assert.equal(eff.ogImageUrl, `${ORIGIN}/og-image.png`);
});

test("没有规范网址时：canonical 未达标，站点地图和分享图片只是建议改进，总分明显下降", () => {
  const report = evaluateSeo(defaultSeoConfig(), "");
  assert.equal(level(defaultSeoConfig(), "canonical", ""), "fail");
  assert.equal(level(defaultSeoConfig(), "sitemap", ""), "warn");
  assert.equal(level(defaultSeoConfig(), "og-image", ""), "warn");
  assert.ok(report.score < 90 && report.score >= 60, String(report.score));
  assert.equal(level(defaultSeoConfig(), "canonical", "http://mail.example.com"), "warn", "http 只是建议改进");
  assert.equal(level(defaultSeoConfig(), "canonical", ORIGIN), "pass");
});

test("按站点名自动生成的标题、描述、关键词随站点名变化，不再出现旧名称", () => {
  const eff = resolveSeo(config({ siteName: "某某邮箱" }), ORIGIN);
  assert.equal(eff.title, "某某邮箱 - 自建邮局的网页邮箱");
  assert.ok(eff.description.startsWith("某某邮箱是给自建"));
  assert.equal(eff.keywords[0], "某某邮箱");
  for (const text of [eff.title, eff.description, eff.keywords.join()]) assert.doesNotMatch(text, /Baka/);
  assert.equal(defaultTitle("X"), "X - 自建邮局的网页邮箱");
  assert.match(defaultDescription("X"), /^X是给自建/);
});

test("标题长度分档：太短未达标、偏短建议、合适达标、偏长建议、过长未达标；边界值", () => {
  const cases: [string, string][] = [
    ["邮箱", "fail"], ["Baka", "fail"], ["邮箱主页入口", "warn"], ["八个汉字的标题啊", "pass"],
    ["一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十", "pass"], // 30 个汉字 = 宽度 60
    ["一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一", "warn"], // 31 个汉字 = 宽度 62
    ["一二三四五六七八九十".repeat(5) + "一", "fail"],                           // 51 个汉字 = 宽度 102
  ];
  for (const [title, expected] of cases) assert.equal(level(config({ homeTitle: title, siteName: "x" }), "title-length"), expected, title);
});

test("描述长度分档与重复检查；标题必须包含站点名", () => {
  const filler = (n: number) => "字".repeat(n);
  const cases: [number, string][] = [[10, "fail"], [25, "warn"], [50, "pass"], [80, "pass"], [86, "warn"], [130, "fail"]];
  for (const [chars, expected] of cases) assert.equal(level(config({ description: filler(chars) }), "description-length"), expected, `${chars} 字`);
  assert.equal(level(config({ homeTitle: "完全一样的文字内容", description: "完全一样的文字内容" }), "description-distinct"), "fail");
  assert.equal(level(config({ homeTitle: "Baka Mail 首页标题" }), "title-brand"), "pass");
  assert.equal(level(config({ homeTitle: "一个没有品牌词的标题" }), "title-brand"), "warn");
  assert.equal(level(config({ siteName: "A".repeat(30) }), "site-name"), "warn");
});

test("关键词、收录、站点地图、结构化数据、站长验证的评分", () => {
  assert.equal(level(config(), "keywords"), "info");
  assert.equal(level(config({ keywords: ["a", "b"] }), "keywords"), "warn");
  assert.equal(level(config({ keywords: ["a", "b", "c"] }), "keywords"), "pass");
  assert.equal(level(config({ keywords: Array.from({ length: 9 }, (_, i) => `k${i}`) }), "keywords"), "warn");
  assert.equal(level(config({ indexHome: false }), "index-home"), "fail");
  assert.equal(level(config({ indexHome: false }), "sitemap"), "info");
  assert.equal(level(config({ sitemap: false }), "sitemap"), "warn");
  assert.equal(level(config({ structuredData: false }), "structured-data"), "warn");
  assert.equal(level(config(), "verification"), "info");
  assert.equal(level(config({ verification: { ...defaultSeoConfig().verification, baidu: "abcdefgh12345" } }), "verification"), "pass");
  const worst = evaluateSeo(config({ indexHome: false, homeTitle: "短", description: "短", sitemap: false, structuredData: false }), "");
  assert.ok(worst.score < 60 && worst.grade === "不达标", `${worst.score} ${worst.grade}`);
});

test("评分：info 不参与计分；warn 算一半；分档 90 / 75 / 60", () => {
  const base = evaluateSeo(defaultSeoConfig(), ORIGIN);
  assert.equal(base.checks.filter((check) => check.level === "info").length, 2);
  const withKeywords = evaluateSeo(config({ keywords: ["a", "b", "c"] }), ORIGIN);
  assert.equal(withKeywords.score, 100);
  const oneWarn = evaluateSeo(config({ structuredData: false }), ORIGIN);
  assert.ok(oneWarn.score < 100 && oneWarn.score >= 95, String(oneWarn.score));
  for (const [score, grade] of [[100, "优秀"], [90, "优秀"], [89, "良好"], [75, "良好"], [74, "需要改进"], [60, "需要改进"], [59, "不达标"]] as const) {
    const expected = score >= 90 ? "优秀" : score >= 75 ? "良好" : score >= 60 ? "需要改进" : "不达标";
    assert.equal(grade, expected, String(score));
  }
});

test("解析：合法提交原样通过；缺省字段取默认；多余空白被压缩", () => {
  const result = parsed({ siteName: "  某某   邮箱  ", tagline: " 一句话 ", homeTitle: "  首页\n标题  " });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.config.siteName, "某某 邮箱");
  assert.equal(result.config.tagline, "一句话");
  assert.equal(result.config.homeTitle, "首页 标题");
  const minimal = parseSeoConfig({});
  assert.ok(minimal.ok && minimal.config.siteName === "Baka Mail");
});

test("解析：站点名必填、最长 30、不含尖括号和控制字符；其他文字字段的长度上限", () => {
  assert.equal(parsed({ siteName: "" }).ok, false);
  assert.equal(parsed({ siteName: "   " }).ok, false);
  assert.equal(parsed({ siteName: "字".repeat(30) }).ok, true);
  assert.equal(parsed({ siteName: "字".repeat(31) }).ok, false);
  assert.equal(parsed({ siteName: "<b>x</b>" }).ok, false);
  assert.equal(parsed({ siteName: "a\u0007b" }).ok, false);
  assert.equal(parsed({ siteName: 5 }).ok, false);
  assert.equal(parsed({ tagline: "字".repeat(41) }).ok, false);
  assert.equal(parsed({ homeTitle: "字".repeat(81) }).ok, false);
  assert.equal(parsed({ description: "字".repeat(300) }).ok, true);
  assert.equal(parsed({ description: "字".repeat(301) }).ok, false);
  assert.equal(parsed({ description: "a\u0000b" }).ok, false);
});

test("解析：未知字段、错误类型、嵌套对象一律拒绝", () => {
  for (const input of [null, [], "x", 1, { extra: 1 }, { verification: { yahoo: "abcdefgh" } }, { verification: [] }, { keywords: "a,b" },
    { keywords: [1] }, { indexHome: "yes" }, { sitemap: 1 }, { structuredData: null }, { twitterCard: "player" }, { themeColor: "red" },
    { themeColor: "#12345" }, { canonicalOrigin: 5 }, { ogImage: 5 }]) {
    assert.equal(parseSeoConfig(input).ok, false, JSON.stringify(input));
  }
});

test("关键词：逗号、顿号、分号和换行都能分隔，去重不分大小写，最多 20 个，单个最长 20 字符", () => {
  assert.deepEqual(parseKeywords("a,b，c、d;e；f\ng\r\nA  ,  b"), ["a", "b", "c", "d", "e", "f", "g"]);
  assert.deepEqual(parseKeywords("  "), []);
  assert.equal(parsed({ keywords: Array.from({ length: 20 }, (_, i) => `k${i}`) }).ok, true);
  assert.equal(parsed({ keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) }).ok, false);
  assert.equal(parsed({ keywords: ["字".repeat(20)] }).ok, true);
  assert.equal(parsed({ keywords: ["字".repeat(21)] }).ok, false);
  assert.equal(parsed({ keywords: ["<script>"] }).ok, false);
});

test("规范网址：只收协议和域名；http 只允许本机；带路径、参数、账号密码、不完整域名都拒绝", () => {
  const accepts: [string, string][] = [["", ""], ["https://mail.example.com", ORIGIN], ["https://MAIL.Example.com/", ORIGIN],
    ["  https://mail.example.com:8443  ", "https://mail.example.com:8443"], ["http://localhost:5190", "http://localhost:5190"], ["http://127.0.0.1", "http://127.0.0.1"]];
  for (const [input, origin] of accepts) {
    const result = normalizeOrigin(input);
    assert.ok(result.ok && result.origin === origin, input);
  }
  for (const input of ["http://mail.example.com", "mail.example.com", "ftp://mail.example.com", "https://mail.example.com/path", "https://mail.example.com?x=1",
    "https://mail.example.com#top", "https://user:pw@mail.example.com", "https://intranet", "javascript:alert(1)", "https://"]) {
    assert.equal(normalizeOrigin(input).ok, false, input);
  }
});

test("分享图片：站内路径或 https 地址，必须是 png/jpg/webp/gif，不能是 svg、路径穿越或带空白", () => {
  for (const input of ["", "/og-image.png", "/img/card.JPG", "https://cdn.example.com/a/card.webp"]) assert.equal(normalizeImage(input).ok, true, input);
  for (const input of ["/logo.svg", "//evil.example/a.png", "/../a.png", "/a.png?x=1", "/a b.png", "http://cdn.example.com/a.png", "https://cdn.example.com/a.svg",
    "https://user:pw@cdn.example.com/a.png", "javascript:alert(1).png", "data:image/png;base64,AAAA", "a.png", `/${"a".repeat(300)}.png`]) {
    assert.equal(normalizeImage(input).ok, false, input);
  }
});

test("站长验证：可以直接粘贴整段 meta 标签；格式不对或平台不支持会被拒绝", () => {
  assert.equal(extractVerification('<meta name="google-site-verification" content="abcDEF_123-xyz" />'), "abcDEF_123-xyz");
  assert.equal(extractVerification("  abcDEF_123  "), "abcDEF_123");
  const result = parsed({ verification: { google: '<meta name="google-site-verification" content="abcDEF_123-xyz" />', baidu: "codeBAIDU12" } });
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.config.verification, { google: "abcDEF_123-xyz", bing: "", baidu: "codeBAIDU12", yandex: "", so360: "" });
  assert.equal(parsed({ verification: { google: "short" } }).ok, false);
  assert.equal(parsed({ verification: { google: "has space in it" } }).ok, false);
  assert.equal(parsed({ verification: { google: '"><script>alert(1)</script>' } }).ok, false);
  assert.equal(parsed({ verification: { google: 5 } }).ok, false);
  assert.deepEqual([...VERIFICATION_KEYS], ["google", "bing", "baidu", "yandex", "so360"]);
});

test("首页头部标签：标题以外的描述、关键词、规范网址、分享卡片、主题色、结构化数据齐全，且只出现一次", () => {
  const head = renderHomeHead(resolveSeo(config({ siteName: "某某邮箱" }), ORIGIN));
  for (const expected of [
    '<meta name="description" content="某某邮箱是给自建', '<meta name="keywords" content="某某邮箱,网页邮箱', '<meta name="robots" content="index, follow, max-image-preview:large',
    `<link rel="canonical" href="${ORIGIN}/" />`, '<meta name="theme-color" content="#F7F9FC" />', '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="某某邮箱" />', `<meta property="og:url" content="${ORIGIN}/" />`, `<meta property="og:image" content="${ORIGIN}/og-image.png" />`,
    '<meta property="og:image:width" content="1200" />', '<meta property="og:image:height" content="630" />', '<meta property="og:locale" content="zh_CN" />',
    '<meta name="twitter:card" content="summary_large_image" />', `<meta name="twitter:image" content="${ORIGIN}/og-image.png" />`,
    '<script type="application/ld+json">',
  ]) assert.ok(head.includes(expected), expected);
  for (const once of ["rel=\"canonical\"", "name=\"description\"", "name=\"robots\"", "og:title", "application/ld+json"]) {
    assert.equal(head.split(once).length - 1, 1, once);
  }
});

test("不收录时输出 noindex；没有规范网址时不输出 canonical、og:url 和分享图片；自定义图片不声明宽高；关闭结构化数据后没有 JSON-LD", () => {
  assert.match(renderHomeHead(resolveSeo(config({ indexHome: false }), ORIGIN)), /<meta name="robots" content="noindex, nofollow" \/>/);
  const bare = renderHomeHead(resolveSeo(config(), ""));
  assert.doesNotMatch(bare, /rel="canonical"|og:url|og:image"|twitter:image/);
  assert.match(bare, /<meta name="twitter:card" content="summary" \/>/, "没有图片时退回小卡片");
  const custom = renderHomeHead(resolveSeo(config({ ogImage: "https://cdn.example.com/card.png" }), ORIGIN));
  assert.match(custom, /og:image" content="https:\/\/cdn\.example\.com\/card\.png"/);
  assert.doesNotMatch(custom, /og:image:width|og:image:height|og:image:type/);
  assert.doesNotMatch(renderHomeHead(resolveSeo(config({ structuredData: false }), ORIGIN)), /ld\+json/);
  const verified = renderHomeHead(resolveSeo(config({ verification: { google: "gcode12345", bing: "bcode12345", baidu: "dcode12345", yandex: "ycode12345", so360: "scode12345" } }), ORIGIN));
  for (const name of ["google-site-verification", "msvalidate.01", "baidu-site-verification", "yandex-verification", "360-site-verification"]) {
    assert.ok(verified.includes(`<meta name="${name}"`), name);
  }
});

test("输出转义：属性、正文和 JSON-LD 里的引号、尖括号、& 和脚本结束标记都不会破坏页面", () => {
  const evil = '</script><img src=x onerror=alert(1)> "q" \'s\' & <b>';
  const result = parsed({ description: evil, homeTitle: evil, ogImage: "", verification: {} });
  assert.ok(result.ok);
  if (!result.ok) return;
  const eff = resolveSeo({ ...result.config, siteName: 'A"B&C' }, ORIGIN);
  const head = renderHomeHead(eff);
  assert.doesNotMatch(head, /<img/);
  assert.doesNotMatch(head.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, ""), /<\/script>/i);
  const ld = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;
  assert.doesNotMatch(ld, /<|>|&/);
  assert.equal(JSON.parse(ld)["@graph"][0].description, evil.replace(/\s+/g, " ").trim());
  assert.ok(head.includes('content="A&quot;B&amp;C"'));
  assert.equal(escapeHtml(`<>"'&`), "&lt;&gt;&quot;&#39;&amp;");
  assert.equal(safeJson({ a: "</script>\u2028\u2029&" }), '{"a":"\\u003c/script\\u003e\\u2028\\u2029\\u0026"}');
  assert.doesNotMatch(renderNoscript(eff, 2026), /<img|<\/script>/);
});

test("结构化数据：网站、网页应用和常见问题；常见问题与页面显示的是同一份内容；没有网址时不输出 url", () => {
  const graph = (structuredData(resolveSeo(config(), ORIGIN)) as { "@graph": Record<string, unknown>[] })["@graph"];
  assert.deepEqual(graph.map((node) => node["@type"]), ["WebSite", "WebApplication", "FAQPage"]);
  assert.equal(graph[0]!.url, `${ORIGIN}/`);
  assert.equal(graph[0]!["@id"], `${ORIGIN}/#website`);
  assert.equal(graph[1]!.applicationCategory, "CommunicationApplication");
  const faq = graph[2]!.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
  assert.deepEqual(faq.map((item) => [item.name, item.acceptedAnswer.text]), INTRO_FAQ.map((item) => [item.question, item.answer]));
  const bare = (structuredData(resolveSeo(config(), "")) as { "@graph": Record<string, unknown>[] })["@graph"];
  assert.ok(!("url" in bare[0]!) && !("@id" in bare[0]!));
});

test("其他页面只输出 noindex、主题色和应用名，不输出描述、canonical 或分享信息", () => {
  const head = renderPrivateHead(resolveSeo(config({ siteName: "某某邮箱" }), ORIGIN));
  assert.match(head, /name="robots" content="noindex, nofollow"/);
  assert.match(head, /name="application-name" content="某某邮箱"/);
  assert.doesNotMatch(head, /description|canonical|og:|ld\+json/);
});

test("robots.txt：只禁止接口；不禁止登录等 noindex 页面，不出现后台路径；站点地图行取决于开关和网址；不收录时整站禁止", () => {
  const on = renderRobotsTxt(resolveSeo(config(), ORIGIN));
  assert.equal(on, `User-agent: *\nDisallow: /api/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  assert.doesNotMatch(on, /Allow/, "不写 Allow，避免按顺序匹配的解析器出错");
  assert.doesNotMatch(on.replace(/^Sitemap:.*$/m, ""), /login|register|mail|admin|setup/i);
  assert.doesNotMatch(renderRobotsTxt(resolveSeo(config({ sitemap: false }), ORIGIN)), /Sitemap/);
  assert.doesNotMatch(renderRobotsTxt(resolveSeo(config(), "")), /Sitemap/);
  assert.equal(renderRobotsTxt(resolveSeo(config({ indexHome: false }), ORIGIN)), "User-agent: *\nDisallow: /\n");
});

test("站点地图：只有首页；不收录、关闭或没有网址时不输出；日期取自保存时间；网址会做 XML 转义", () => {
  const xml = renderSitemapXml(resolveSeo(config(), ORIGIN), "2026-10-12T08:00:00.000Z")!;
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.equal(xml.split("<url>").length - 1, 1);
  assert.ok(xml.includes(`<loc>${ORIGIN}/</loc>`) && xml.includes("<lastmod>2026-10-12</lastmod>"));
  assert.ok(!renderSitemapXml(resolveSeo(config(), ORIGIN), "")!.includes("<lastmod>"));
  assert.equal(renderSitemapXml(resolveSeo(config({ indexHome: false }), ORIGIN), ""), null);
  assert.equal(renderSitemapXml(resolveSeo(config({ sitemap: false }), ORIGIN), ""), null);
  assert.equal(renderSitemapXml(resolveSeo(config(), ""), ""), null);
  assert.ok(renderSitemapXml({ ...resolveSeo(config(), ORIGIN), origin: "https://a.example.com/?a=1&b=2" }, "")!.includes("a=1&amp;b=2"));
});

test("无脚本正文：包含站点名、描述、功能和问答，底部固定带开源仓库和版权标记，不受站点名影响", () => {
  const html = renderNoscript(resolveSeo(config({ siteName: "某某邮箱", tagline: "我的副标题" }), ORIGIN), 2026);
  assert.match(html, /<h1>某某邮箱<\/h1><p>我的副标题<\/p>/);
  for (const item of INTRO_FAQ) assert.ok(html.includes(item.question));
  assert.ok(html.includes(`<a href="${SEO_REPOSITORY_URL}" rel="noopener noreferrer">开源仓库</a>`));
  assert.ok(html.includes("© 2026 saubaka. BakaMail."));
  assert.ok(html.includes("邮件服务基于 Maddy，第三方项目版权归原作者所有。"));
});
