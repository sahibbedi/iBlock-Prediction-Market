import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, generateToken, decodeToken, canTrade } from "./security.ts";
process.env.AUTH_SECRET = "test-secret-only-never-use-in-production-123456";
test("password hashes use unique salts and reject incorrect passwords", () => {
  const a = hashPassword("correct-password"), b = hashPassword("correct-password");
  assert.notEqual(a,b); assert.ok(verifyPassword("correct-password",a)); assert.ok(!verifyPassword("wrong",a));
});
test("tokens reject legacy impersonation and tampering", () => {
  assert.equal(decodeToken(Buffer.from("1:any:ibpm-secret-key").toString("base64")), null);
  const token = generateToken(1, 3);
  assert.equal(decodeToken(token)?.sub, 1); assert.equal(decodeToken(token)?.version, 3);
  assert.equal(decodeToken(token.replace(/^./, token[0] === "a" ? "b" : "a")), null);
});
test("only participant roles have trading capabilities", () => {
  assert.ok(canTrade("trader") && canTrade("market_maker"));
  for (const role of ["observer", "admin", "teacher", "student", "anything"]) assert.ok(!canTrade(role));
});
