import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { PublicKey, Connection, Transaction, TransactionInstruction, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Buffer } from "buffer";
import idl from "../idl/ibpm.json";
import type { Ibpm } from "../idl/ibpm";

export const PROGRAM_ID = new PublicKey(idl.address);
export const YES = 1, NO = 2;
export const TRADER = 0, MAKER = 1;
const U64_MAX = (1n << 64n) - 1n;
export function u64(value: bigint): Buffer {
  if (value < 0n || value > U64_MAX) throw new Error("Value is outside u64 range");
  const data = Buffer.alloc(8); data.writeBigUInt64LE(value, 0); return data;
}
/** Parse decimal input exactly. Never pass GIES through a floating point number. */
export function gies(value: string): BN {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error("Use a positive decimal with at most six decimal places");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  u64(units);
  return new BN(units.toString());
}
export function formatGies(units: BN | bigint): string {
  const value = BigInt(units.toString()), n = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0")}`;
}
export function addresses(programId = PROGRAM_ID) {
  const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, programId)[0];
  const config = pda(Buffer.from("config"));
  const mint = pda(Buffer.from("gies_mint"));
  return {
    config, mint, treasury: pda(Buffer.from("treasury")),
    user: (wallet: PublicKey) => pda(Buffer.from("user"), wallet.toBuffer()),
    desk: (wallet: PublicKey) => pda(Buffer.from("desk"), wallet.toBuffer()),
    market: (id: bigint) => pda(Buffer.from("market"), u64(id)),
    vault: (market: PublicKey) => pda(Buffer.from("vault"), market.toBuffer()),
    position: (market: PublicKey, owner: PublicKey) => pda(Buffer.from("pos"), market.toBuffer(), owner.toBuffer()),
    lp: (market: PublicKey, owner: PublicKey) => pda(Buffer.from("lp"), market.toBuffer(), owner.toBuffer()),
    reward: (claimId: bigint) => pda(Buffer.from("reward"), u64(claimId)),
    ata: (wallet: PublicKey) => getAssociatedTokenAddressSync(mint, wallet),
  };
}
export function createReadProgram(connection: Connection) {
  return new Program<Ibpm>(idl as unknown as Ibpm, { connection });
}
export function createClient(provider: AnchorProvider) {
  const program = new Program<Ibpm>(idl as unknown as Ibpm, provider);
  const a = addresses(program.programId);
  function tradeAccounts(wallet: PublicKey, market: PublicKey) {
    return { trader: wallet, config: a.config, traderUser: a.user(wallet), market, vault: a.vault(market), position: a.position(market, wallet), traderGies: a.ata(wallet), giesMint: a.mint, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId };
  }
  const positive = (value: BN) => { if (value.lte(new BN(0))) throw new Error("Amount must be positive"); };
  const outcome = (side: number) => { if (side !== YES && side !== NO) throw new Error("Outcome must be YES (1) or NO (2)"); };
  return {
    program, addresses: a,
    async membership(wallet: PublicKey) { return program.account.user.fetchNullable(a.user(wallet)); },
    async buy(wallet: PublicKey, marketId: bigint, side: number, amount: BN, minTokens: BN) {
      positive(amount); positive(minTokens); outcome(side);
      return program.methods.buy(side, amount, minTokens).accountsStrict(tradeAccounts(wallet, a.market(marketId))).instruction();
    },
    async sell(wallet: PublicKey, marketId: bigint, side: number, tokens: BN, minGies: BN) {
      positive(tokens); positive(minGies); outcome(side);
      return program.methods.sell(side, tokens, minGies).accountsStrict(tradeAccounts(wallet, a.market(marketId))).instruction();
    },
    async addLiquidity(wallet: PublicKey, marketId: bigint, amount: BN) {
      positive(amount);
      const market = a.market(marketId), { traderGies, ...accounts } = tradeAccounts(wallet, market);
      return program.methods.addLiquidity(amount).accountsStrict({ ...accounts, lp: a.lp(market, wallet), desk: a.desk(wallet) }).instruction();
    },
    async removeLiquidity(wallet: PublicKey, marketId: bigint, shares: BN) {
      positive(shares);
      const market = a.market(marketId), { traderGies, ...accounts } = tradeAccounts(wallet, market);
      return program.methods.removeLiquidity(shares).accountsStrict({ ...accounts, lp: a.lp(market, wallet), desk: a.desk(wallet) }).instruction();
    },
    async redeem(wallet: PublicKey, marketId: bigint, side: number) {
      outcome(side);
      const { config, traderUser, systemProgram, ...accounts } = tradeAccounts(wallet, a.market(marketId));
      return program.methods.redeem(side).accountsStrict(accounts).instruction();
    },
  };
}
/** Put these in .remainingAccounts(...) BEFORE building a committee instruction. */
export function committeeSigners(payer: PublicKey, members: PublicKey[]) {
  return [...new Map(members.filter(m => !m.equals(payer)).map(m => [m.toBase58(), m])).values()].map(pubkey => ({ pubkey, isSigner: true, isWritable: false }));
}
export async function prepareTransaction(connection: Connection, payer: PublicKey, instructions: TransactionInstruction[]) {
  const validity = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: payer, ...validity }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...instructions);
  return { transaction, ...validity };
}
/** Caller collects wallet signatures on the SAME transaction before calling this. */
export async function submitSigned(connection: Connection, signed: Transaction, validity: { blockhash: string; lastValidBlockHeight: number }, onSubmitted?: (signature: string) => void) {
  if (signed.recentBlockhash !== validity.blockhash) throw new Error("Signed transaction blockhash changed");
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  onSubmitted?.(signature);
  const result = await connection.confirmTransaction({ signature, ...validity }, "confirmed");
  if (result.value.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(result.value.err)}`);
  return signature;
}

/** Prove a logged-in campus account owns a wallet. This never enrolls or funds it. */
export async function linkCampusWallet(token: string, wallet: PublicKey, signMessage: (message: Uint8Array) => Promise<Uint8Array>) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const challenge = await fetch("/api/auth/wallet-challenge", { method: "POST", headers, body: JSON.stringify({ wallet: wallet.toBase58() }) });
  const body = await challenge.json() as { message?: string; error?: string };
  if (!challenge.ok || typeof body.message !== "string") throw new Error(body.error || "Wallet challenge failed");
  const signature = await signMessage(new TextEncoder().encode(body.message));
  const linked = await fetch("/api/auth/link-wallet", { method: "POST", headers, body: JSON.stringify({ signature: Buffer.from(signature).toString("base64") }) });
  const result = await linked.json() as { walletAddress?: string; error?: string };
  if (!linked.ok || typeof result.walletAddress !== "string") throw new Error(result.error || "Wallet link failed");
  return result as { walletAddress: string };
}
