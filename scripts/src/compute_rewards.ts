/** Read-only fee attribution preview. Committee proposals are the only payout path. */
import { db, pool, lpSnapshotsTable } from "@workspace/db";
const [from, to] = process.argv.slice(2);
if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) throw new Error("Usage: compute_rewards <from ISO timestamp> <to ISO timestamp> (read-only)");
try {
  const snapshots = (await db.select().from(lpSnapshotsTable)).filter(s => s.takenAt >= new Date(from) && s.takenAt < new Date(to));
  const groups = new Map<string, typeof snapshots>();
  for (const s of snapshots) { const key = `${s.userId}:${s.marketId}`; groups.set(key, [...(groups.get(key) || []), s]); }
  const fees = new Map<number, number>();
  for (const rows of groups.values()) {
    rows.sort((a,b) => +a.takenAt - +b.takenAt);
    for (let i = 1; i < rows.length; i++) {
      const delta = Math.max(0, Number(rows[i].marketCumulativeFees) - Number(rows[i-1].marketCumulativeFees));
      fees.set(rows[i].userId, (fees.get(rows[i].userId) || 0) + Number(rows[i-1].poolShare) * delta);
    }
  }
  console.log(JSON.stringify({ from, to, method: "Hourly snapshot estimate; review deposits/withdrawals and interval boundaries before approving", fees: [...fees].map(([userId, attributedFees]) => ({ userId, attributedFees })) }, null, 2));
} finally { await pool.end(); }
