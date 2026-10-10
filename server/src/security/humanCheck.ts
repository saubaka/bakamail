import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import pngjs from "pngjs";
import { config } from "../config.ts";
import { db, nowIso } from "../db.ts";
import { enforceBudget } from "./abuse.ts";

const { PNG } = pngjs;

/** 去掉 I O 0 1 等易混字符 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 4;

/** 5x7 点阵字模，每个字符 7 行、每行 5 位 */
const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

const WIDTH = 176;
const HEIGHT = 56;
const SCALE = 6;

type Rgba = [number, number, number];

const INK: Rgba = [53, 64, 82]; // --text #354052
const PAPER: Rgba = [247, 249, 252]; // --canvas #f7f9fc
const ACCENT: Rgba = [168, 208, 244]; // --blue-300 #a8d0f4
const FAINT: Rgba = [207, 216, 228]; // --gray-300 #cfd8e4

function setPixel(image: InstanceType<typeof PNG>, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const index = (image.width * y + x) << 2;
  image.data[index] = color[0];
  image.data[index + 1] = color[1];
  image.data[index + 2] = color[2];
  image.data[index + 3] = 255;
}

function drawGlyph(
  image: InstanceType<typeof PNG>,
  glyph: string,
  originX: number,
  originY: number,
  color: Rgba,
): void {
  const rows = GLYPHS[glyph];
  if (!rows) return;
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row] ?? "";
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] !== "1") continue;
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          setPixel(image, originX + col * SCALE + dx, originY + row * SCALE + dy, color);
        }
      }
    }
  }
}

function drawLine(
  image: InstanceType<typeof PNG>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgba,
): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    setPixel(image, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), color);
  }
}

function renderPng(answer: string): Buffer {
  const image = new PNG({ width: WIDTH, height: HEIGHT });
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) setPixel(image, x, y, PAPER);
  }

  const glyphWidth = 5 * SCALE;
  const gap = 10;
  const totalWidth = answer.length * glyphWidth + (answer.length - 1) * gap;
  let x = Math.round((WIDTH - totalWidth) / 2);
  for (const character of answer) {
    const baseline = Math.round((HEIGHT - 7 * SCALE) / 2) + randomInt(-4, 5);
    drawGlyph(image, character, x, baseline, INK);
    x += glyphWidth + gap;
  }

  // 干扰线：两条穿字，两条只走背景
  for (let i = 0; i < 4; i += 1) {
    const color = i < 2 ? ACCENT : FAINT;
    drawLine(
      image,
      randomInt(0, 20),
      randomInt(4, HEIGHT - 4),
      WIDTH - randomInt(0, 20),
      randomInt(4, HEIGHT - 4),
      color,
    );
  }
  // 噪点
  for (let i = 0; i < 220; i += 1) {
    setPixel(image, randomInt(0, WIDTH), randomInt(0, HEIGHT), i % 3 === 0 ? FAINT : ACCENT);
  }

  return PNG.sync.write(image);
}

function digest(purpose: string, targetKey: string, nonce: string, answer: string): string {
  return createHmac("sha256", config.secretKey)
    .update([purpose, targetKey, nonce, answer.toUpperCase()].join("|"))
    .digest("hex");
}

export type HumanChallenge = {
  nonce: string;
  imageData: string;
  expiresIn: number;
};

export function issueHumanCheck(
  purpose: string,
  targetKey = "",
  identityHash = "",
): HumanChallenge {
  // 后台登录的验证码额度独立于邮箱用户，同一出口 IP 下的其他人刷验证码不会让管理员拿不到验证码。
  enforceBudget(purpose.startsWith("admin-") ? "challenge-admin" : "challenge", identityHash || targetKey);
  purgeExpiredChallenges();
  const answer = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(0, ALPHABET.length)])
    .join("");
  const nonce = randomBytes(16).toString("base64url").slice(0, 22);
  const issuedAt = Math.floor(Date.now() / 1000);
  const ttl = config.security.humanCheckTtlSeconds;
  const png = renderPng(answer);

  db.prepare(
    `insert into human_challenges
       (purpose, target_key, nonce, digest, issued_at, expires_at, fingerprint)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    purpose,
    targetKey,
    nonce,
    digest(purpose, targetKey, nonce, answer),
    issuedAt,
    issuedAt + ttl,
    identityHash,
  );

  // 只保留最近 8 条同类挑战，与规划一致
  db.prepare(
    `delete from human_challenges
     where purpose = ? and target_key = ? and id not in (
       select id from human_challenges where purpose = ? and target_key = ?
       order by id desc limit 8
     )`,
  ).run(purpose, targetKey, purpose, targetKey);

  return {
    nonce,
    imageData: `data:image/png;base64,${png.toString("base64")}`,
    expiresIn: ttl,
  };
}

export function verifyHumanCheck(
  purpose: string,
  targetKey: string,
  nonce: string,
  answer: string,
  budgetIdentity = targetKey,
): boolean {
  enforceBudget(purpose.startsWith("admin-") ? "human-verify-admin" : "human-verify", budgetIdentity);
  const normalized = (answer ?? "").trim().toUpperCase();
  const row = db
    .prepare(
      `update human_challenges set consumed_at = ?
       where purpose = ? and target_key = ? and nonce = ? and consumed_at is null
       returning id, digest, expires_at`,
    )
    .get(nowIso(), purpose, targetKey, String(nonce).slice(0, 100)) as
    | { id: number; digest: string; expires_at: number }
    | undefined;

  if (!row) return false;
  // 一次性消费：无论成功失败都标记，防止重放

  if (normalized.length !== LENGTH) return false;
  if (row.expires_at <= Math.floor(Date.now() / 1000)) return false;
  if (config.security.humanCheckTestMode) return true;

  const expected = digest(purpose, targetKey, nonce, normalized);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(row.digest, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function purgeExpiredChallenges(): number {
  const cutoff = Math.floor(Date.now() / 1000);
  const result = db.prepare("delete from human_challenges where expires_at < ?").run(cutoff);
  return Number(result.changes ?? 0);
}
