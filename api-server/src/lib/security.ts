import crypto from "node:crypto";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, hash: string): boolean {
  if (!hash.startsWith("scrypt:")) {
    const legacy = crypto.createHash("sha256").update(password + "ibpm-salt-2025").digest("hex");
    return safeEqual(legacy, hash);
  }
  const [, salt, digest] = hash.split(":");
  return !!salt && !!digest && safeEqual(crypto.scryptSync(password, salt, 64).toString("hex"), digest);
}
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return value;
}
export function generateToken(userId: number, version = 0): string {
  const body = Buffer.from(JSON.stringify({ sub: userId, version, exp: Date.now() + 12 * 3600_000 })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function decodeToken(token: string): { sub: number; version: number } | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (!safeEqual(expected, signature)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    return Number.isSafeInteger(data.sub) && data.sub > 0 && Number.isSafeInteger(data.version) && data.exp > Date.now() ? data : null;
  } catch { return null; }
}
export const canTrade = (role: string) => role === "trader" || role === "market_maker";
