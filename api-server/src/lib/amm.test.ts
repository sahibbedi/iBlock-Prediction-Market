import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore - .ts extension is required to run this with `node --experimental-strip-types --test`
import { quoteBuy, quoteSell, quoteBuyExactTokens, getPrice } from "./amm.ts";

const FEE = 0.02;

test("buying YES raises the YES price; buying NO lowers it", () => {
  assert.ok(quoteBuy(1000, 1000, "yes", 100, FEE).newYesPrice > 0.5);
  assert.ok(quoteBuy(1000, 1000, "no", 100, FEE).newYesPrice < 0.5);
});

test("selling YES lowers the YES price", () => {
  const buy = quoteBuy(1000, 1000, "yes", 100, FEE);
  const before = getPrice(buy.newYesPool, buy.newNoPool).yesPrice;
  const sell = quoteSell(buy.newYesPool, buy.newNoPool, "yes", buy.tokenAmount, FEE);
  assert.ok(sell.newYesPrice < before);
});

test("constant product k is preserved by a buy", () => {
  const b = quoteBuy(1000, 1000, "yes", 137, FEE);
  assert.ok(Math.abs(b.newYesPool * b.newNoPool - 1000 * 1000) < 1e-6);
});

test("quoteBuy and quoteBuyExactTokens are inverse", () => {
  for (const [y, n, o] of [[1000,1000,"yes"],[300,700,"yes"],[700,300,"no"]] as const) {
    const b = quoteBuy(y, n, o, 120, FEE);
    const e = quoteBuyExactTokens(y, n, o, b.tokenAmount, FEE);
    assert.ok(Math.abs(e.giesCost - 120) < 1e-6);
  }
});

test("a buy locks full collateral and mints the net as complete sets", () => {
  const b = quoteBuy(1000, 1000, "yes", 100, FEE);
  assert.ok(Math.abs(b.vaultDelta - 100) < 1e-9);
  assert.ok(Math.abs(b.supplyDelta - 98) < 1e-9);
});

test("a buy-then-sell round trip never creates money", () => {
  const buy = quoteBuy(1000, 1000, "yes", 100, FEE);
  const received = Math.abs(quoteSell(buy.newYesPool, buy.newNoPool, "yes", buy.tokenAmount, FEE).giesCost);
  assert.ok(received < 100 && received > 90);
});

test("PROPERTY: 5000 random trades stay solvent and conserve supply", () => {
  let rng = 12345;
  const rand = () => { rng = (rng*1103515245+12345)&0x7fffffff; return rng/0x7fffffff; };
  const m = { y: 1000, n: 1000, vault: 1000, supY: 1000, supN: 1000 };
  let userYes = 0, userNo = 0;
  for (let i = 0; i < 5000; i++) {
    const outcome = rand() < 0.5 ? "yes" : "no";
    if (rand() < 0.6) {
      const q = quoteBuy(m.y, m.n, outcome, 1 + rand()*120, FEE);
      m.y = q.newYesPool; m.n = q.newNoPool; m.vault += q.vaultDelta; m.supY += q.supplyDelta; m.supN += q.supplyDelta;
      if (outcome === "yes") userYes += q.tokenAmount; else userNo += q.tokenAmount;
    } else {
      const held = outcome === "yes" ? userYes : userNo;
      if (held < 1) continue;
      const s = 1 + rand()*(held - 1);
      const q = quoteSell(m.y, m.n, outcome, s, FEE);
      m.y = q.newYesPool; m.n = q.newNoPool; m.vault += q.vaultDelta; m.supY += q.supplyDelta; m.supN += q.supplyDelta;
      if (outcome === "yes") userYes -= s; else userNo -= s;
    }
    assert.ok(m.y > 0 && m.n > 0, `reserves positive @${i}`);
    assert.ok(Math.abs(m.supY - m.supN) < 1e-4, `complete-set conservation @${i}`);
    assert.ok(m.vault + 1e-4 >= Math.max(m.supY, m.supN), `solvency vault>=supply @${i}`);
    assert.ok(Math.abs((m.y + userYes) - m.supY) < 1e-3, `YES conservation @${i}`);
    assert.ok(Math.abs((m.n + userNo) - m.supN) < 1e-3, `NO conservation @${i}`);
  }
});
