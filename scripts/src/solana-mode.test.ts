import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
process.env.MARKET_BACKEND = "solana";
process.env.AUTH_SECRET = "test-secret-only-never-use-in-production-123456";
test("Solana mode refuses legacy database financial reads and writes", async () => {
  const { default: app } = await import("../../api-server/src/app.js");
  const server = app.listen(0,"127.0.0.1"); await once(server,"listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No local port");
  const base=`http://127.0.0.1:${address.port}/api`;
  try {
    const runtime = await fetch(`${base}/runtime`); assert.equal((await runtime.json()).backend,"solana");
    for (const path of ["/markets","/wallet/balance","/leaderboard"]) assert.equal((await fetch(base+path)).status,503);
    for (const path of ["/trades","/liquidity/provide"]) assert.equal((await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).status,503);
    assert.equal((await fetch(`${base}/auth/me`)).status,200);
  } finally { server.close(); }
});
