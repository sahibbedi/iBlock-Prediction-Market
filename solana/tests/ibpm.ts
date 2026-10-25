import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "chai";
import { Ibpm } from "../target/types/ibpm";

const GIES = new BN(1_000_000);
const KIND_TRADER = 0;
const KIND_MAKER = 1;
const OUTCOME_YES = 1;
const OUTCOME_NO = 2;
const STATUS_OPEN = 0;
const STATUS_CLOSED = 1;
const STATUS_RESOLVED = 2;
const CU = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

describe("ibpm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ibpm as Program<Ibpm>;
  const admin = provider.wallet as anchor.Wallet;
  const memberB = Keypair.generate();
  const memberC = Keypair.generate();
  const trader = Keypair.generate();
  const maker = Keypair.generate();
  const outsider = Keypair.generate();

  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const [giesMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("gies_mint")],
    program.programId
  );
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  function userPda(wallet: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("user"), wallet.toBuffer()],
      program.programId
    )[0];
  }
  function deskPda(wallet: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("desk"), wallet.toBuffer()],
      program.programId
    )[0];
  }
  function marketPda(id: number) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(id));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("market"), buf],
      program.programId
    )[0];
  }
  function vaultPda(market: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), market.toBuffer()],
      program.programId
    )[0];
  }
  function posPda(market: PublicKey, owner: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pos"), market.toBuffer(), owner.toBuffer()],
      program.programId
    )[0];
  }
  function lpPda(market: PublicKey, owner: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), market.toBuffer(), owner.toBuffer()],
      program.programId
    )[0];
  }
  function ata(wallet: PublicKey) {
    return getAssociatedTokenAddressSync(giesMint, wallet);
  }
  function committee(keys: PublicKey[]) {
    const members = Array.from({ length: 7 }, () => PublicKey.default);
    keys.forEach((key, i) => {
      members[i] = key;
    });
    return members;
  }
  function cosign(extra: Keypair[]) {
    return extra.map((kp) => ({
      pubkey: kp.publicKey,
      isSigner: true,
      isWritable: false,
    }));
  }
  async function expectFail(fn: () => Promise<unknown>, pattern: RegExp) {
    try {
      await fn();
      expect.fail("expected instruction to fail");
    } catch (e: unknown) {
      expect(String(e)).to.match(pattern);
    }
  }
  async function airdrop(pk: PublicKey) {
    const sig = await provider.connection.requestAirdrop(pk, 2e9);
    const latest = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  }

  const routine = [memberB];
  const resolve = [memberB, memberC];

  before(async () => {
    await airdrop(admin.publicKey);
    await airdrop(memberB.publicKey);
    await airdrop(memberC.publicKey);
    await airdrop(trader.publicKey);
    await airdrop(maker.publicKey);
    await airdrop(outsider.publicKey);
  });

  it("seats a 3-person committee with a higher bar for resolution", async () => {
    await program.methods
      .initialize(committee([admin.publicKey, memberB.publicKey, memberC.publicKey]), 3, 2, 3)
      .accountsPartial({
        programData: PublicKey.findProgramAddressSync([program.programId.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0],
        payer: admin.publicKey,
        config,
        giesMint,
        treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(config);
    expect(c.memberCount).to.equal(3);
    expect(c.routineThreshold).to.equal(2);
    expect(c.resolveThreshold).to.equal(3);
    expect(c.members[0].toBase58()).to.equal(admin.publicKey.toBase58());
    expect(c.starterAmount.eq(new BN(5_000).mul(GIES))).to.equal(true);
    expect(c.makerCapital.eq(new BN(15_000).mul(GIES))).to.equal(true);
  });

  it("rejects a lone committee member on routine actions", async () => {
    await expectFail(
      () =>
        program.methods
          .mintToTreasury(new BN(1_000).mul(GIES))
          .accountsPartial({
            payer: admin.publicKey,
            config,
            giesMint,
            treasury,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
      /ThresholdNotMet/
    );
    await expectFail(
      () =>
        program.methods
          .setPaused(true)
          .accountsPartial({ payer: outsider.publicKey, config })
          .signers([outsider])
          .rpc(),
      /NotCommittee/
    );
  });

  it("lets two members set economics and fund the treasury", async () => {
    await program.methods
      .setEconomics(
        new BN(5_000).mul(GIES),
        new BN(15_000).mul(GIES),
        200,
        500,
        2_500,
        new BN(1_000).mul(GIES)
      )
      .accountsPartial({ payer: admin.publicKey, config })
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
    const c = await program.account.config.fetch(config);
    expect(c.feeMatchBps).to.equal(2_500);
    expect(c.rewardBudget.eq(new BN(1_000).mul(GIES))).to.equal(true);

    await program.methods
      .mintToTreasury(new BN(4_000).mul(GIES))
      .accountsPartial({
        payer: admin.publicKey,
        config,
        giesMint,
        treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
  });

  it("opens market 0 from treasury liquidity", async () => {
    await expectFail(
      () =>
        program.methods
          .createMarket(new BN(1), new BN(1_000).mul(GIES), null, null, null)
          .accountsPartial(createAccounts(1))
          .remainingAccounts(cosign(routine))
          .signers(routine)
          .rpc(),
      /MarketIdMismatch/
    );

    await program.methods
      .createMarket(new BN(0), new BN(1_000).mul(GIES), 10_000, null, 2_500)
      .preInstructions([CU])
      .accountsPartial(createAccounts(0))
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();

    const market = await program.account.market.fetch(marketPda(0));
    expect(market.status).to.equal(STATUS_OPEN);
    expect(market.yesPool.eq(new BN(1_000).mul(GIES))).to.equal(true);
    expect(market.noPool.eq(market.yesPool)).to.equal(true);
    expect(market.creator.toBase58()).to.equal(config.toBase58());
    expect(market.maxPriceImpactBps).to.equal(10_000);
    const lp = await program.account.lpPosition.fetch(lpPda(marketPda(0), config));
    expect(lp.shares.eq(new BN(1_000).mul(GIES))).to.equal(true);
  });

  it("enrolls a trader, pays the starter once, and lets them trade", async () => {
    await program.methods
      .enroll(KIND_TRADER)
      .accountsPartial(enrollAccounts(trader.publicKey))
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
    const user = await program.account.user.fetch(userPda(trader.publicKey));
    expect(user.kind).to.equal(KIND_TRADER);
    expect(user.active).to.equal(true);

    await program.methods
      .grantStarter()
      .accountsPartial(grantAccounts(trader.publicKey))
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
    await expectFail(
      () =>
        program.methods
          .grantStarter()
          .accountsPartial(grantAccounts(trader.publicKey))
          .remainingAccounts(cosign(routine))
          .signers(routine)
          .rpc(),
      /StarterAlreadyClaimed/
    );

    const market = marketPda(0);
    await expectFail(
      () =>
        program.methods
          .buy(OUTCOME_NO, new BN(600).mul(GIES), new BN(0))
          .preInstructions([CU])
          .accountsPartial(tradeAccounts(trader.publicKey, market))
          .signers([trader])
          .rpc(),
      /TradeTooLarge/
    );
    await expectFail(
      () =>
        program.methods
          .buy(OUTCOME_YES, new BN(10).mul(GIES), new BN(0))
          .accountsPartial(tradeAccounts(outsider.publicKey, market))
          .signers([outsider])
          .rpc(),
      /AccountNotInitialized|not initialized/i
    );
    await expectFail(
      () =>
        program.methods
          .addLiquidity(new BN(10).mul(GIES))
          .preInstructions([CU])
          .accountsPartial(lpAccounts(trader.publicKey, market))
          .signers([trader])
          .rpc(),
      /NotMaker/
    );

    await program.methods
      .buy(OUTCOME_YES, new BN(50).mul(GIES), new BN(0))
      .preInstructions([CU])
      .accountsPartial(tradeAccounts(trader.publicKey, market))
      .signers([trader])
      .rpc();
    const bought = await program.account.position.fetch(posPda(market, trader.publicKey));
    expect(bought.yesAmount.gt(new BN(0))).to.equal(true);
    const half = bought.yesAmount.div(new BN(2));
    await program.methods
      .sell(OUTCOME_YES, half, new BN(0))
      .preInstructions([CU])
      .accountsPartial(tradeAccounts(trader.publicKey, market))
      .signers([trader])
      .rpc();
    const left = await program.account.position.fetch(posPda(market, trader.publicKey));
    expect(left.yesAmount.eq(bought.yesAmount.sub(half))).to.equal(true);
  });

  it("appoints a maker, funds persistent capital, and round-trips liquidity", async () => {
    await program.methods
      .enroll(KIND_MAKER)
      .accountsPartial(enrollAccounts(maker.publicKey))
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
    await program.methods
      .allocateMakerCapital(new BN(200).mul(GIES))
      .accountsPartial(capitalAccounts(maker.publicKey))
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();

    const market = marketPda(0);
    await program.methods
      .addLiquidity(new BN(100).mul(GIES))
      .preInstructions([CU])
      .accountsPartial(lpAccounts(maker.publicKey, market))
      .signers([maker])
      .rpc();
    const lp = await program.account.lpPosition.fetch(lpPda(market, maker.publicKey));
    expect(lp.shares.gt(new BN(0))).to.equal(true);
    const makerUser = await program.account.user.fetch(userPda(maker.publicKey));
    expect(makerUser.openLpCount).to.equal(1);

    await expectFail(
      () =>
        program.methods
          .setKind(KIND_TRADER)
          .accountsPartial(updateAccounts(maker.publicKey))
          .remainingAccounts(cosign(routine))
          .signers(routine)
          .rpc(),
      /OpenLpPositions/
    );

    await program.methods
      .removeLiquidity(lp.shares)
      .preInstructions([CU])
      .accountsPartial(lpAccounts(maker.publicKey, market))
      .signers([maker])
      .rpc();
    const after = await program.account.user.fetch(userPda(maker.publicKey));
    expect(after.openLpCount).to.equal(0);

    const desk = await getAccount(provider.connection, deskPda(maker.publicKey));
    const idle = new BN(desk.amount.toString());
    expect(idle.gt(new BN(0))).to.equal(true);

    await expectFail(
      () =>
        program.methods
          .clawbackMakerCapital(idle)
          .accountsPartial(capitalAccounts(maker.publicKey))
          .rpc(),
      /ThresholdNotMet/
    );
    await program.methods
      .clawbackMakerCapital(idle)
      .accountsPartial(capitalAccounts(maker.publicKey))
      .remainingAccounts(cosign(resolve))
      .signers(resolve)
      .rpc();
    const emptied = await getAccount(provider.connection, deskPda(maker.publicKey));
    expect(emptied.amount.toString()).to.equal("0");

    await program.methods
      .setKind(KIND_TRADER)
      .accountsPartial(updateAccounts(maker.publicKey))
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
    const demoted = await program.account.user.fetch(userPda(maker.publicKey));
    expect(demoted.kind).to.equal(KIND_TRADER);
  });

  it("lets any one member pause, and requires two to unpause", async () => {
    await program.methods.setPaused(true).accountsPartial({ payer: admin.publicKey, config }).rpc();
    await expectFail(
      () =>
        program.methods
          .buy(OUTCOME_NO, new BN(10).mul(GIES), new BN(0))
          .preInstructions([CU])
          .accountsPartial(tradeAccounts(trader.publicKey, marketPda(0)))
          .signers([trader])
          .rpc(),
      /Paused/
    );
    await expectFail(
      () => program.methods.setPaused(false).accountsPartial({ payer: admin.publicKey, config }).rpc(),
      /ThresholdNotMet/
    );
    await program.methods
      .setPaused(false)
      .accountsPartial({ payer: admin.publicKey, config })
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
  });

  it("requires the full committee to resolve, then the trader redeems", async () => {
    const market = marketPda(0);
    await expectFail(
      () =>
        program.methods
          .resolveMarket(OUTCOME_YES)
          .accountsPartial({ payer: admin.publicKey, config, market })
          .remainingAccounts(cosign(routine))
          .signers(routine)
          .rpc(),
      /ThresholdNotMet/
    );
    await program.methods
      .resolveMarket(OUTCOME_YES)
      .accountsPartial({ payer: admin.publicKey, config, market })
      .remainingAccounts(cosign(resolve))
      .signers(resolve)
      .rpc();
    const resolved = await program.account.market.fetch(market);
    expect(resolved.status).to.equal(STATUS_RESOLVED);
    expect(resolved.outcome).to.equal(OUTCOME_YES);

    await program.methods
      .redeem(OUTCOME_YES)
      .preInstructions([CU])
      .accountsPartial({
        trader: trader.publicKey,
        market,
        vault: vaultPda(market),
        position: posPda(market, trader.publicKey),
        traderGies: ata(trader.publicKey),
        giesMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([trader])
      .rpc();
    const pos = await program.account.position.fetch(posPda(market, trader.publicKey));
    expect(pos.yesAmount.toNumber()).to.equal(0);
  });

  it("revokes a trader without trapping an open position", async () => {
    await program.methods
      .createMarket(new BN(1), new BN(1_000).mul(GIES), 10_000, null, 2_500)
      .preInstructions([CU])
      .accountsPartial(createAccounts(1))
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
    const market = marketPda(1);
    await program.methods
      .buy(OUTCOME_NO, new BN(20).mul(GIES), new BN(0))
      .preInstructions([CU])
      .accountsPartial(tradeAccounts(trader.publicKey, market))
      .signers([trader])
      .rpc();

    await program.methods
      .setActive(false)
      .accountsPartial(updateAccounts(trader.publicKey))
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
    await expectFail(
      () =>
        program.methods
          .buy(OUTCOME_NO, new BN(10).mul(GIES), new BN(0))
          .preInstructions([CU])
          .accountsPartial(tradeAccounts(trader.publicKey, market))
          .signers([trader])
          .rpc(),
      /Inactive/
    );

    const pos = await program.account.position.fetch(posPda(market, trader.publicKey));
    await program.methods
      .sell(OUTCOME_NO, pos.noAmount, new BN(0))
      .preInstructions([CU])
      .accountsPartial(tradeAccounts(trader.publicKey, market))
      .signers([trader])
      .rpc();

    await program.methods
      .closeMarket()
      .accountsPartial({ payer: admin.publicKey, config, market })
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
    const closed = await program.account.market.fetch(market);
    expect(closed.status).to.equal(STATUS_CLOSED);
  });

  it("returns seed liquidity to the treasury", async () => {
    await program.methods
      .createMarket(new BN(2), new BN(500).mul(GIES), null, null, null)
      .preInstructions([CU])
      .accountsPartial(createAccounts(2))
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
    const market = marketPda(2);
    const before = await getAccount(provider.connection, treasury);
    await program.methods
      .withdrawProtocolLiquidity(new BN(200).mul(GIES))
      .preInstructions([CU])
      .accountsPartial({
        payer: admin.publicKey,
        config,
        market,
        vault: vaultPda(market),
        lp: lpPda(market, config),
        position: posPda(market, config),
        treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(cosign(routine))
      .signers(routine)
      .rpc();
    const lp = await program.account.lpPosition.fetch(lpPda(market, config));
    expect(lp.shares.eq(new BN(300).mul(GIES))).to.equal(true);
    const after = await getAccount(provider.connection, treasury);
    expect(new BN(after.amount.toString()).sub(new BN(before.amount.toString())).eq(new BN(200).mul(GIES))).to.equal(
      true
    );
  });

  it("enforces signed slippage floors and rejects one-person committee settings", async () => {
    await program.methods.setActive(true).accountsPartial(updateAccounts(trader.publicKey)).remainingAccounts(cosign(routine)).signers(routine).rpc();
    await expectFail(() => program.methods.buy(OUTCOME_YES, new BN(10).mul(GIES), new BN(9999).mul(GIES))
      .accountsPartial(tradeAccounts(trader.publicKey, marketPda(2))).signers([trader]).rpc(), /SlippageExceeded/);
    await expectFail(() => program.methods.setCommittee(committee([admin.publicKey]), 1, 1, 1)
      .accountsPartial({ payer: admin.publicKey, config }).remainingAccounts(cosign(resolve)).signers(resolve).rpc(), /InvalidCommittee/);
    // The duplicate-signature check below uses the higher (3-of-3) resolution threshold.
    await expectFail(() => program.methods.setCommittee(committee([admin.publicKey, memberB.publicKey, memberC.publicKey]), 3, 2, 3)
      .accountsPartial({ payer: admin.publicKey, config }).remainingAccounts(cosign([memberB, memberB])).signers([memberB]).rpc(), /ThresholdNotMet|duplicate/i);
  });

  it("pays fee-match rewards once, under the committee and emissions budget", async () => {
    await program.methods.setKind(KIND_MAKER).accountsPartial(updateAccounts(maker.publicKey)).remainingAccounts(cosign(routine)).signers(routine).rpc();
    const evidence = Array.from({ length: 32 }, () => 7);
    const claim = (id: number) => PublicKey.findProgramAddressSync([Buffer.from("reward"), new BN(id).toArrayLike(Buffer, "le", 8)], program.programId)[0];
    const rewardAccounts = (id: number) => ({ ...grantAccounts(maker.publicKey), claim: claim(id) });
    await expectFail(() => program.methods.payReward(new BN(0), new BN(100).mul(GIES), evidence).accountsPartial(rewardAccounts(0)).rpc(), /ThresholdNotMet/);
    await expectFail(() => program.methods.payReward(new BN(1), new BN(9000).mul(GIES), evidence).accountsPartial(rewardAccounts(1)).remainingAccounts(cosign(resolve)).signers(resolve).rpc(), /RewardBudgetExceeded/);
    await program.methods.payReward(new BN(0), new BN(100).mul(GIES), evidence).accountsPartial(rewardAccounts(0)).remainingAccounts(cosign(resolve)).signers(resolve).rpc();
    const receipt = await program.account.rewardClaim.fetch(claim(0));
    expect(receipt.amount.eq(new BN(25).mul(GIES))).to.equal(true);
    const c = await program.account.config.fetch(config);
    expect(c.rewardBudget.eq(new BN(975).mul(GIES))).to.equal(true);
    await expectFail(() => program.methods.payReward(new BN(0), new BN(100).mul(GIES), evidence).accountsPartial(rewardAccounts(0)).remainingAccounts(cosign(resolve)).signers(resolve).rpc(), /already in use|custom program error|already initialized/i);
  });

  it("moves upgrade custody to the committee and upgrades only with its full threshold", async () => {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost):/.test(provider.connection.rpcEndpoint)) throw new Error("Upgrade test is local-validator only");
    const walletPath = process.env.ANCHOR_WALLET;
    if (!walletPath) throw new Error("ANCHOR_WALLET required for local loader test");
    const directory = mkdtempSync(join(tmpdir(), "ibpm-upgrade-"));
    const buffer = Keypair.generate(), path = join(directory, "buffer.json");
    writeFileSync(path, JSON.stringify(Array.from(buffer.secretKey)), { mode: 0o600 });
    const cli = (args: string[]) => execFileSync("solana", [...args, "--url", provider.connection.rpcEndpoint, "--keypair", walletPath], { stdio: "pipe" });
    try {
      await airdrop(admin.publicKey);
      cli(["program", "write-buffer", "target/deploy/ibpm.so", "--buffer", path, "--use-rpc"]);
      cli(["program", "set-buffer-authority", buffer.publicKey.toBase58(), "--new-buffer-authority", config.toBase58()]);
      cli(["program", "set-upgrade-authority", program.programId.toBase58(), "--new-upgrade-authority", config.toBase58(), "--skip-new-upgrade-authority-signer-check"]);
      const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
      const programData = PublicKey.findProgramAddressSync([program.programId.toBuffer()], loader)[0];
      const accounts = { payer: admin.publicKey, config, program: program.programId, programData, buffer: buffer.publicKey, loader, rent: anchor.web3.SYSVAR_RENT_PUBKEY, clock: anchor.web3.SYSVAR_CLOCK_PUBKEY };
      await expectFail(() => program.methods.upgradeProgram().accountsPartial(accounts).remainingAccounts(cosign(routine)).signers(routine).rpc(), /ThresholdNotMet/);
      await program.methods.upgradeProgram().accountsPartial(accounts).remainingAccounts(cosign(resolve)).signers(resolve).rpc();
      const data = await provider.connection.getAccountInfo(programData);
      expect(new PublicKey(data!.data.subarray(13,45)).equals(config)).to.equal(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  function createAccounts(id: number) {
    const market = marketPda(id);
    return {
      payer: admin.publicKey,
      config,
      market,
      vault: vaultPda(market),
      protocolLp: lpPda(market, config),
      treasury,
      giesMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }
  function enrollAccounts(wallet: PublicKey) {
    return {
      payer: admin.publicKey,
      config,
      wallet,
      user: userPda(wallet),
      giesMint,
      desk: deskPda(wallet),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }
  function grantAccounts(recipient: PublicKey) {
    return {
      payer: admin.publicKey,
      config,
      recipient,
      recipientUser: userPda(recipient),
      giesMint,
      recipientGies: ata(recipient),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }
  function updateAccounts(wallet: PublicKey) {
    return {
      payer: admin.publicKey,
      config,
      user: userPda(wallet),
      desk: deskPda(wallet),
      giesMint,
    };
  }
  function capitalAccounts(wallet: PublicKey) {
    return {
      payer: admin.publicKey,
      config,
      user: userPda(wallet),
      giesMint,
      desk: deskPda(wallet),
      treasury,
      tokenProgram: TOKEN_PROGRAM_ID,
    };
  }
  function tradeAccounts(who: PublicKey, market: PublicKey) {
    return {
      trader: who,
      config,
      traderUser: userPda(who),
      market,
      vault: vaultPda(market),
      position: posPda(market, who),
      traderGies: ata(who),
      giesMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }
  function lpAccounts(who: PublicKey, market: PublicKey) {
    return {
      trader: who,
      config,
      traderUser: userPda(who),
      market,
      vault: vaultPda(market),
      lp: lpPda(market, who),
      position: posPda(market, who),
      desk: deskPda(who),
      giesMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }
});
