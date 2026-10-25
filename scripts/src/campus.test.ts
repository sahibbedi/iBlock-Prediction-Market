import crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { db, pool, usersTable, platformConfigTable } from "@workspace/db";
import { hashPassword } from "../../api-server/src/lib/security.js";
import { createRequire } from "node:module";
const bs58 = createRequire(new URL("../../api-server/package.json", import.meta.url))("bs58").default;
import app from "../../api-server/src/app.js";

// This test intentionally refuses any production/remote database.
const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== "127.0.0.1" || url.pathname !== "/ibpm_campus_test") throw new Error("Use only the isolated local ibpm_campus_test database");
process.env.AUTH_SECRET = "test-secret-only-never-use-in-production-123456";
test("campus permissions, committee approval, persistent maker capital and bounded rewards", async () => {
  await pool.query("TRUNCATE wallet_challenges, committee_proposals, reward_claims, transactions, trades, price_history, positions, lp_positions, markets, roster, users, platform_config, user_badges, market_ideas, market_idea_votes, market_comments RESTART IDENTITY CASCADE");
  for (let n=1; n<=3; n++) await db.insert(usersTable).values({ username: `admin${n}`, displayName: `Admin ${n}`, passwordHash: hashPassword("test-password-123"), role: "admin" });
  await db.insert(platformConfigTable).values({ id: 1, routineThreshold: 2, resolveThreshold: 3, feeMatch: "1", rewardBudget: "20000" });
  const server = app.listen(0, "127.0.0.1"); await once(server,"listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing port");
  const port = address.port;
  async function request(path: string, token?: string, data?: unknown, method?: string) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: method || (data===undefined ? "GET":"POST"), headers: { "Content-Type":"application/json", ...(token ? { Authorization:`Bearer ${token}` }: {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await response.json().catch(()=>null); return { status: response.status, body };
  }
  try {
    const admins: string[]=[];
    for (let n=1;n<=3;n++) { const r=await request("/auth/login",undefined,{ username:`admin${n}`,password:"test-password-123" }); assert.equal(r.status,200); admins.push(r.body.token); }
    async function proposal(action: unknown, threshold=2) {
      const created=await request("/committee/proposals",admins[0],action); assert.equal(created.status,201,JSON.stringify(created.body));
      let result=created;
      for (let i=1;i<threshold;i++) result=await request(`/committee/proposals/${created.body.id}/approve`,admins[i],{});
      assert.equal(result.status,200,JSON.stringify(result.body)); assert.equal(result.body.status,"executed"); return result;
    }
    assert.equal((await request("/markets")).status,200);
    assert.equal((await request("/wallet/balance")).body.giesBalance,0);
    assert.equal((await request("/users",Buffer.from("1:x:ibpm-secret-key").toString("base64"))).status,403);
    assert.equal((await request("/trades",undefined,{ marketId:1,side:"buy",outcome:"yes",amount:10,amountType:"gies" })).status,401);
    assert.equal((await request("/markets",admins[0],{})).status,409);
    const pending=await request("/committee/proposals",admins[0],{type:"treasury",amount:10000});
    const twice=await request(`/committee/proposals/${pending.body.id}/approve`,admins[0],{});
    assert.deepEqual(twice.body.approvals,[1]); assert.equal(twice.body.status,"pending");
    const second=await request(`/committee/proposals/${pending.body.id}/approve`,admins[1],{}); assert.equal(second.body.status,"pending");
    assert.equal((await request(`/committee/proposals/${pending.body.id}/approve`,admins[2],{})).body.status,"executed");
    assert.equal((await request(`/committee/proposals/${pending.body.id}/approve`,admins[2],{})).status,404);
    await proposal({type:"roster",email:"campustest@illinois.edu",displayName:"Campus test",active:true});
    const registration=await request("/auth/register",undefined,{email:"campustest@illinois.edu",password:"test-participant-password"});
    assert.equal(registration.status,201,JSON.stringify(registration.body)); const token=registration.body.token, userId=registration.body.user.id;
    assert.equal(registration.body.user.role,"trader"); assert.equal(registration.body.user.giesBalance,5000);
    const pair = crypto.generateKeyPairSync("ed25519");
    const publicBytes = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const wallet = bs58.encode(publicBytes);
    const challenge = await request("/auth/wallet-challenge", token, { wallet });
    assert.equal(challenge.status,200);
    assert.equal((await request("/auth/link-wallet",token,{ signature: Buffer.alloc(64).toString("base64") })).status,403);
    const signature = crypto.sign(null,Buffer.from(challenge.body.message),pair.privateKey).toString("base64");
    assert.equal((await request("/auth/link-wallet",token,{ signature })).body.walletAddress,wallet);
    assert.equal((await request("/auth/link-wallet",token,{ signature })).status,400);
    assert.equal((await request("/committee/proposals",token,{type:"treasury",amount:1})).status,403);
    assert.equal((await request("/liquidity/provide",token,{marketId:1,giesAmount:10})).status,403);
    await proposal({type:"role",userId,role:"market_maker"},3);
    await proposal({type:"capital",userId,amount:15000});
    assert.equal((await request("/wallet/balance",token)).body.deskBalance,15000);
    await proposal({type:"create_market",title:"Campus launch",description:"Will the test pass?",resolutionCriteria:"The automated test result",initialLiquidity:1000});
    assert.equal((await request("/trades",token,{marketId:1,side:"buy",outcome:"yes",amount:-10,amountType:"gies"})).status,400);
    const buy=await request("/trades",token,{marketId:1,side:"buy",outcome:"yes",amount:20,amountType:"gies"}); assert.equal(buy.status,200,JSON.stringify(buy.body));
    const lp=await request("/liquidity/provide",token,{marketId:1,giesAmount:100}); assert.equal(lp.status,200,JSON.stringify(lp.body));
    assert.equal((await request("/committee/pause",admins[0],{})).status,200);
    assert.equal((await request("/trades",token,{marketId:1,side:"buy",outcome:"yes",amount:10,amountType:"gies"})).status,403);
    assert.equal((await request("/liquidity/provide",token,{marketId:1,giesAmount:10})).status,403);
    const positions=await request("/liquidity/positions",token); const shares=positions.body[0].lpShares;
    assert.equal((await request("/liquidity/remove",token,{marketId:1,lpShares:shares})).status,200);
    assert.ok((await request("/wallet/balance",token)).body.deskBalance > 14900);
    await proposal({type:"pause",paused:false});
    await proposal({type:"reward",userId,claimId:"2026-10-24:user4",attributedFees:10,evidence:"test-report-sha256:interval-1"},3);
    const before=(await request("/wallet/balance",token)).body.giesBalance;
    const duplicate=await request("/committee/proposals",admins[0],{type:"reward",userId,claimId:"2026-10-24:user4",attributedFees:10,evidence:"test-report-sha256:interval-1"});
    await request(`/committee/proposals/${duplicate.body.id}/approve`,admins[1],{});
    assert.equal((await request(`/committee/proposals/${duplicate.body.id}/approve`,admins[2],{})).status,409);
    assert.equal((await request("/wallet/balance",token)).body.giesBalance,before);
    await proposal({type:"membership",userId,active:false});
    assert.equal((await request("/trades",token,{marketId:1,side:"buy",outcome:"yes",amount:10,amountType:"gies"})).status,403);
    const held=await request("/wallet/positions",token);
    const sell=await request("/trades",token,{marketId:1,side:"sell",outcome:"yes",amount:held.body.find((p:any)=>p.outcome==="yes").tokenAmount / 2,amountType:"tokens"}); assert.equal(sell.status,200,JSON.stringify(sell.body));
    await proposal({type:"resolve_market",marketId:1,outcome:"yes"},3);
    assert.equal((await request("/wallet/redeem",token,{marketId:1,outcome:"yes"})).status,200);
    const reset=await request(`/users/${userId}/reset-password`,admins[0],{}); assert.equal(reset.status,200);
    assert.equal((await request("/ideas",token,{title:"Old token",description:"Should fail"})).status,401);
    const adminReset = await request("/users/3/reset-password", admins[0], {});
    assert.equal(adminReset.body.status, "pending");
    assert.equal((await request("/auth/login", undefined, { username: "admin3", password: adminReset.body.tempPassword })).status,401);
    await request(`/committee/proposals/${adminReset.body.proposalId}/approve`,admins[1],{});
    assert.equal((await request(`/committee/proposals/${adminReset.body.proposalId}/approve`,admins[2],{})).body.status,"executed");
    assert.equal((await request("/committee",admins[2])).status,403);
    assert.equal((await request("/auth/login", undefined, { username: "admin3", password: adminReset.body.tempPassword })).status,200);
  } finally { server.close(); await pool.end(); }
});
