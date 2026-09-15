/**
 * LP REWARD COMPUTATION (cycle-end payout + calibration/preview).
 *
 * Reads lp_snapshots for a rotation group and computes each maker's fee-match
 * reward, gated by the eligibility floor and capped by the per-cycle budget.
 *
 * Runs DRY by default (prints, changes nothing). Pass --commit to actually pay
 * rewards into personal balances.
 *
 *   pnpm --filter @workspace/scripts exec tsx src/compute_rewards.ts 1           # preview group 1
 *   pnpm --filter @workspace/scripts exec tsx src/compute_rewards.ts 1 --commit  # pay group 1
 *
 * ==========================================================================
 *  THE PUBLISHED REWARD SPEC — these constants ARE what you announce to makers.
 *  Tune them on a dev simulation until: active LP > 0, passive hold-to-resolution < 0.
 * ==========================================================================
 */
import { db, pool, lpSnapshotsTable, usersTable, transactionsTable } from "@workspace/db";
import crypto from "crypto";

// Bonus paid = MULTIPLIER x (fees your liquidity earned), to personal balance.
const FEE_MATCH_MULTIPLIER = 1.0;      // 100% fee match (starting point)
const CYCLE_REWARD_BUDGET = 20000;     // cap on total bonus GIES emitted per cycle

// Eligibility floor — must be met for >= MIN_UPTIME_FRAC of the cycle's snapshots:
const MIN_DEPLOYED = 6000;             // >= this much GIES deployed in total
const MIN_MARKETS = 2;                 // across >= this many markets
const MIN_PER_MARKET = 1500;           // with >= this in each counted market
const MIN_UPTIME_FRAC = 0.6;           // for >= 60% of the cycle

function txHash(): string {
  return "0x" + crypto.randomBytes(32).toString("hex");
}

type Snap = typeof lpSnapshotsTable.$inferSelect;

async function computeForGroup(group: number, commit: boolean) {
  const allSnaps = await db.select().from(lpSnapshotsTable);
  const snaps = allSnaps.filter((s) => s.cycleGroup === group);
  if (snaps.length === 0) {
    console.log(`No snapshots found for rotation group ${group}. Nothing to reward.`);
    return;
  }

  // Distinct snapshot timestamps across the cycle = the "buckets" we score uptime against.
  const bucketKeys = Array.from(new Set(snaps.map((s) => new Date(s.takenAt).toISOString())));
  const totalBuckets = bucketKeys.length;

  const users = await db.select().from(usersTable);
  const nameById = new Map(users.map((u) => [u.id, u.username]));

  // Group this group's snapshots by maker.
  const byUser = new Map<number, Snap[]>();
  for (const s of snaps) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    byUser.get(s.userId)!.push(s);
  }

  const results: {
    userId: number;
    username: string;
    feesEarned: number;
    uptime: number;
    eligible: boolean;
    raw: number;
    reward: number;
  }[] = [];

  for (const [userId, rows] of byUser) {
    // ---- Fee attribution: per market, sum (poolShare at interval start) * (delta cumulativeFees) ----
    const byMarket = new Map<number, Snap[]>();
    for (const r of rows) {
      if (!byMarket.has(r.marketId)) byMarket.set(r.marketId, []);
      byMarket.get(r.marketId)!.push(r);
    }
    let feesEarned = 0;
    for (const mrows of byMarket.values()) {
      mrows.sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());
      for (let i = 1; i < mrows.length; i++) {
        const dFees =
          parseFloat(mrows[i].marketCumulativeFees) - parseFloat(mrows[i - 1].marketCumulativeFees);
        if (dFees > 0) feesEarned += parseFloat(mrows[i - 1].poolShare) * dFees;
      }
    }

    // ---- Eligibility floor: fraction of buckets where the maker met the bar ----
    const byBucket = new Map<string, Snap[]>();
    for (const r of rows) {
      const k = new Date(r.takenAt).toISOString();
      if (!byBucket.has(k)) byBucket.set(k, []);
      byBucket.get(k)!.push(r);
    }
    let qualifying = 0;
    for (const brows of byBucket.values()) {
      const totalDeployed = brows.reduce((a, r) => a + parseFloat(r.deployedValue), 0);
      const marketsCovered = brows.filter((r) => parseFloat(r.deployedValue) >= MIN_PER_MARKET).length;
      if (totalDeployed >= MIN_DEPLOYED && marketsCovered >= MIN_MARKETS) qualifying++;
    }
    const uptime = totalBuckets > 0 ? qualifying / totalBuckets : 0;
    const eligible = uptime >= MIN_UPTIME_FRAC;

    results.push({
      userId,
      username: nameById.get(userId) ?? `#${userId}`,
      feesEarned,
      uptime,
      eligible,
      raw: eligible ? FEE_MATCH_MULTIPLIER * feesEarned : 0,
      reward: 0,
    });
  }

  // ---- Budget cap: scale down pro-rata if total would exceed the budget ----
  const totalRaw = results.reduce((a, r) => a + r.raw, 0);
  const scale = totalRaw > CYCLE_REWARD_BUDGET && totalRaw > 0 ? CYCLE_REWARD_BUDGET / totalRaw : 1;
  for (const r of results) r.reward = r.raw * scale;

  // ---- Report ----
  results.sort((a, b) => b.reward - a.reward);
  console.log(`\nLP rewards — rotation group ${group}  (${commit ? "COMMIT" : "DRY RUN"})`);
  console.log(`  snapshots: ${snaps.length} rows across ${totalBuckets} time buckets`);
  console.log(`  spec: ${FEE_MATCH_MULTIPLIER}x fee match, budget ${CYCLE_REWARD_BUDGET}, ` +
    `floor ${MIN_DEPLOYED}/${MIN_MARKETS}mkts/${MIN_PER_MARKET}ea/${Math.round(MIN_UPTIME_FRAC * 100)}%`);
  if (scale < 1) console.log(`  budget cap active: scaling all rewards by ${(scale * 100).toFixed(1)}%`);
  console.log("  " + "user".padEnd(16) + "fees".padStart(12) + "uptime".padStart(10) + "  elig" + "reward".padStart(12));
  for (const r of results) {
    console.log(
      "  " +
        r.username.padEnd(16) +
        r.feesEarned.toFixed(2).padStart(12) +
        (r.uptime * 100).toFixed(0).padStart(9) + "%" +
        (r.eligible ? "   Y " : "   - ") +
        r.reward.toFixed(2).padStart(11)
    );
  }
  console.log(`  TOTAL reward: ${results.reduce((a, r) => a + r.reward, 0).toFixed(2)} GIES\n`);

  // ---- Pay (only with --commit) ----
  if (commit) {
    for (const r of results.filter((x) => x.reward > 1e-9)) {
      // Update balance via the pooled client (avoids needing drizzle-orm in the scripts pkg).
      await pool.query(
        "UPDATE users SET gies_balance = gies_balance + $1::numeric WHERE id = $2",
        [r.reward.toFixed(6), r.userId]
      );
      await db.insert(transactionsTable).values({
        userId: r.userId,
        type: "lp_reward",
        amount: r.reward.toFixed(6),
        description: `LP reward (cycle group ${group}): ${r.reward.toFixed(2)} GIES`,
        txHash: txHash(),
      });
    }
    console.log("Rewards committed to personal balances.");
  } else {
    console.log("(dry run — nothing changed. Add --commit to pay.)");
  }
}

const group = parseInt(String(process.argv[2]));
const commit = process.argv.includes("--commit");
if (![1, 2, 3].includes(group)) {
  console.error("Usage: compute_rewards <group 1|2|3> [--commit]");
  process.exit(1);
}
computeForGroup(group, commit)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
