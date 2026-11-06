import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { config } from "../config.ts";

function keyFor(context: string): Buffer {
  return Buffer.from(hkdfSync("sha256", config.secretKey, "", context, 32));
}

export function sealWith(context: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(context), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function openWith(context: string, sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(context), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
