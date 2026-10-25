# iBPM campus handoff

The committee runs the platform. Makers are standing appointments. Traders use personal balances. Observers can look around without enrolling or receiving funds. There is no rotation or cycle settlement.

The campus permissions are implemented in the web API and Solana program. The existing web screens still execute against PostgreSQL by default. The shared Solana client is ready for the frontend integration; wallet screens and a chain indexer still need to be connected before switching the app to chain mode.

## 1. Roles and money

| Role | What it can do |
| --- | --- |
| Admin committee | Create, configure, close and resolve markets; manage membership; appoint/fund makers; authorize rewards; pause and upgrade |
| Market maker | All trader actions, plus provide/remove liquidity from persistent maker capital |
| Trader | Buy, sell, redeem, submit ideas and view |
| Observer | View markets, leaderboard and an empty personal portfolio; no balance or trading |

We follow the maker-only liquidity rule in the permission matrix. The on-chain maker flag is the appointment option described in the role model's design decisions. Buying and selling check enrollment, not a separate maker privilege. There is no teacher/oracle/resolver tier. A committee wallet does not receive participant capital automatically.

GIES has six decimals. A new trader receives the configured starter amount once (default 5,000). The maker capital policy defaults to 15,000, but appointment and funding are separate committee actions. Additional grants are explicit. Capital stays in the maker desk until withdrawn or clawed back. LP withdrawals return matched GIES to that desk; leftover outcome claims stay in the maker's position. Personal directional trading uses the personal GIES account.

Fees are reinvested into pool reserves as complete sets so LP shares benefit. The fee-match is a separate, committee-approved reward. Its multiplier is 0-100%; the budget is the remaining authorized emissions. Rewards start disabled on a fresh deployment until configured. Payout mints GIES to the maker's personal account and records a unique claim. There is no automatic hourly mint.

Paused/inactive participants cannot add new risk. Selling an existing position, withdrawing existing liquidity and redeeming remain possible. Remove LP positions and claw back idle desk capital before demoting a maker. Revoking membership stops new activity without confiscating existing claims.

## 2. Start from these files

| File | Use |
| --- | --- |
| `solana/client/index.ts` | Import as `@workspace/solana-client`: PDAs, exact amounts, wallet linking, transaction helpers |
| `solana/idl/ibpm.json` | Runtime IDL generated from this program version |
| `solana/idl/ibpm.ts` | Matching TypeScript IDL type |
| `solana/tests/ibpm.ts` | Working account lists and committee examples for every core flow |
| `solana/programs/ibpm/src/state.rs` | On-chain account fields |
| `api-server/src/lib/governance.ts` | Database-mode proposal actions and validation |
| `api-server/src/routes/auth.ts` | Campus login, roster signup, and wallet ownership verification |

Dependencies are pinned in the workspace: `@coral-xyz/anchor` 0.32.1, `@solana/web3.js` 1.98.4 and `@solana/spl-token` 0.4.13. Use `pnpm install --frozen-lockfile` at the root. The frontend already has a workspace dependency on the client. Do not mix a web3 v2 client into this integration. Current Anchor documentation may show a newer package name; use the versions in this repo.

The current program address is `EiMn8BEsdfuxEedNGi2vr12cjbKhGpq5Bq5N2ecCdnnM`. That identifies this build; it is not evidence that this version is deployed on a public cluster. Use the same cluster, program address, binary and IDL throughout. This revision changes instruction signatures/account layouts and is not an automatic migration of an older deployment.

## 3. Connect a user

1. Keep campus signup/login for the email allowlist and off-chain account. Signup grants a database balance only in database mode; it does not grant on-chain money.
2. Connect a Solana wallet. Use `linkCampusWallet(token, wallet.publicKey, wallet.signMessage)` to link it to the campus account. The API issues a five-minute message, verifies its Ed25519 signature, and consumes it once. One wallet can belong to one campus account. Wallet replacement requires a reviewed migration of positions.
3. Give the committee the verified wallet address. The committee calls `enroll(TRADER)` or `enroll(MAKER)`. An email login or a successful link does not enroll a wallet.
4. The committee calls `grantStarter` once for the enrolled wallet. For a maker it separately calls `allocateMakerCapital(amount)`.
5. Read membership and balances from the chain. No enrollment account means observer. `kind=0` means trader; `kind=1` means maker. `active=false` means exits only. Identify committee members from `config.members`, independently of participant enrollment.

Observers can use `createReadProgram(connection)` and read accounts without a wallet/provider signer. Do not infer on-chain permissions from an editable browser role or the database role field.

## 4. First trade

With a connected wallet adapter, create an Anchor provider and use the workspace client:

```ts
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  createClient, gies, YES,
  prepareTransaction, submitSigned,
} from "@workspace/solana-client";

const provider = new AnchorProvider(connection, anchorWallet, {
  commitment: "confirmed",
});
const client = createClient(provider);
const ix = await client.buy(
  anchorWallet.publicKey,
  0n,                 // chain market ID, not the PostgreSQL ID
  YES,                // YES=1, NO=2
  gies("25"),         // spend 25 GIES exactly
  gies(minTokensText) // output floor from a fresh quote + slippage setting
);
const prepared = await prepareTransaction(
  connection, anchorWallet.publicKey, [ix]
);
const signed = await anchorWallet.signTransaction(prepared.transaction);
const signature = await submitSigned(connection, signed, prepared, sig => {
  // Persist sig immediately; show pending until confirmation succeeds.
});
// Refetch market, position, personal ATA, and desk/LP accounts as needed.
```

`minTokensText` is a decimal token amount from your quote UI, not a fixed example number. Both buys and sells include a signed minimum output; the client rejects a zero floor. Use RPC simulation of the exact instruction or implement a quote adapter against current integer reserves and fee settings. A stale HTTP quote from database mode is not a chain quote.

All monetary `u64` values use `BN`/bigint. Parse user input with `gies("12.345678")`; never multiply JavaScript floats by a million. Market IDs use eight-byte little-endian encoding. Enum values: open/closed/resolved = 0/1/2; no resolved outcome = 0; YES/NO = 1/2. LP shares also use integer units; they are not the user's GIES balance.

YES/NO claims live in the program's `Position` account. They are not separate transferable SPL token mints. Personal GIES lives in the wallet ATA; maker GIES lives in a program-controlled desk token account.

## 5. Account map

All seeds below are scoped to the chosen program ID. Use the helper instead of duplicating them.

| Account | Seeds |
| --- | --- |
| Config / GIES mint / treasury | `config` / `gies_mint` / `treasury` |
| Enrollment / maker desk | `user, wallet` / `desk, wallet` |
| Market | `market, market_id_u64_le` |
| Market collateral vault | `vault, market_pubkey` |
| Outcome position / LP position | `pos, market, wallet` / `lp, market, wallet` |
| Reward receipt | `reward, claim_id_u64_le` |

`grantStarter`, `grantGies` and `payReward` can create the recipient ATA. A wallet also needs SOL for transaction fees and any new account rent. The GIES balance does not pay SOL fees.

## 6. Committee approvals

The native program implements a committee multisignature check directly. There are 2-7 members. Routine actions require at least two signatures; resolution, committee changes, maker-capital clawback, rewards and upgrades use the configured resolution threshold, which is at least the routine threshold. Any one member can emergency-pause. Unpause needs routine approval.

Build the instruction with the payer as one member and other members in `.remainingAccounts(committeeSigners(payer, otherMembers))`. Each additional member must actually sign the **same transaction message**. Adding their public keys without signatures does not count, and duplicate keys count once. Build via `client.program.methods`; the integration test contains complete accounts for each method.

For example, `resolveMarket(YES)` uses `{ payer, config, market }` plus the extra signers. Keep all private keys in member wallets. Do not put committee keypairs in the frontend or ask the backend to hold everyone's keys. Collect signatures before the blockhash expires. If you rebuild the message/blockhash, collect all signatures again.

Web database mode uses authenticated committee proposals instead: `POST /api/committee/proposals`, then `POST /api/committee/proposals/:id/approve`. The proposer counts once. Proposals expire after seven days; committee membership/threshold changes invalidate pending proposals. These HTTP approvals do **not** authorize a chain transaction. Resetting another admin's password also needs a sensitive proposal, so one admin cannot seize the other approval accounts. Participant password resets are direct admin operations and invalidate existing sessions.

## 7. Rewards and indexer work

The committee reviews an off-chain LP fee-attribution report and calls `payReward(claimId, attributedFees, evidenceHash)`. The program computes the configured match, checks the remaining budget, mints the payout, and creates a nonclosable receipt so that claim ID cannot be replayed. Use one canonical claim ID per maker/report interval. The committee must reject overlapping or duplicate reports even if submitted with a different ID. The report hash identifies the evidence; the program does not independently recompute historical LP eligibility.

`TradeExecuted` includes market, wallet, buy/sell side, outcome, GIES/token amounts, fee, and post-trade reserves. An indexer should store the transaction signature and instruction/event location as its unique key, backfill missed transactions, and reconcile confirmed data to finalized chain state. Refetch accounts after confirmation; an optimistic frontend balance is not settlement evidence. Preserve the submitted signature when confirmation times out. Check its status before offering another submission.

Keep titles, descriptions, resolution criteria/source links, roster/cohorts, ideas and leaderboard views off-chain. Map each metadata record to **cluster + program ID + market public key**. Chain balances, collateral and resolution win if a cache disagrees. `scripts/src/compute_rewards.ts` is a read-only snapshot estimate for database mode; it is not the chain indexer or a payout authority.

## 8. Deployment and cutover

1. Choose committee wallets and thresholds. Build the program and regenerate IDL with `pnpm --filter ibpm-program build` and `pnpm --filter ibpm-program idl`.
2. Deploy to the chosen cluster, then initialize while the deployer is still the upgrade authority. Bootstrap verifies that authority; an unrelated wallet cannot initialize first.
3. Transfer program upgrade authority to the derived config PDA. This is an operator action, not something this code push executes:

   ```sh
   solana program set-upgrade-authority <PROGRAM_ID> \
     --new-upgrade-authority <CONFIG_PDA> \
     --skip-new-upgrade-authority-signer-check --url <RPC>
   ```

4. Read the deployed ProgramData account back and verify its authority is config. Future upgrades use `upgradeProgram` with the sensitive committee threshold. Upload the reviewed binary to a loader buffer first, transfer that buffer's authority to config, then co-sign the upgrade instruction. The local test exercises this entire sequence. Do not transfer authority to an address derived for another program or cluster.
5. Configure economics, fund the treasury, enroll participants, grant starters, and separately appoint/fund makers. Store market metadata before opening each market.
6. Finish wallet screens, same-message committee signing, chain reads, quotes, history/indexer, and transaction status handling. Validate these on devnet. Then set the API's `MARKET_BACKEND=solana` and matching `SOLANA_PROGRAM_ID`. Legacy financial reads/writes return 503 in that mode to prevent a second ledger. Login, wallet linking, off-chain roster/password proposals and discussion remain available. HTTP financial-governance proposals are disabled; use native committee signatures.
7. Use a new campus database. The checked-in baseline is not an in-place beta migration. Carrying balances/claims from beta or upgrading old on-chain accounts requires an explicit migration plan.

No public-cluster deployment, authority transfer or production database migration was performed as part of this change. The frontend integration remains the next owner's work. The tests verify the implementation locally; they do not establish a production deployment or an independent contract audit.

## Verification

Web production build and TypeScript checks, authentication/AMM unit tests, isolated PostgreSQL API integration tests, Solana Rust unit tests, browser-target client bundling, client helper tests, and 13 local-validator scenarios pass. The validator suite includes threshold failures, dedicated maker funding, revoked-member exits, signed slippage, reward budget/replay checks, and an actual committee-controlled program upgrade. Browser automation was unavailable, so the changed web screens have build/API verification but no rendered UI inspection in this run.

Primary references: [Anchor TypeScript client](https://www.anchor-lang.com/docs/clients/typescript), [Anchor IDL CLI](https://www.anchor-lang.com/docs/references/cli), [Solana program upgrades](https://solana.com/docs/core/programs/program-deployment). The repo's pinned versions and generated IDL take precedence over examples for newer SDK releases.
