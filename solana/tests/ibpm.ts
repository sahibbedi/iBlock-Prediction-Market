import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  ComputeBudgetProgram,
  TransactionSignature,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { Ibpm } from "../target/types/ibpm";

const GIES = new BN(1_000_000);
const ROLE_STUDENT = 0;
const ROLE_MAKER = 1;
const ROLE_TEACHER = 2;
const ROLE_ADMIN = 3;
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
  const student = Keypair.generate();
  const maker = Keypair.generate();
  const outsider = Keypair.generate();

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [giesMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("gies_mint")],
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

  async function confirm(sig: TransactionSignature) {
    const latest = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      { signature: sig, ...latest },
      "confirmed"
    );
  }

  async function airdrop(pk: PublicKey, lamports = 2e9) {
    const sig = await provider.connection.requestAirdrop(pk, lamports);
    await confirm(sig);
  }

  async function expectIxFail(fn: () => Promise<unknown>, pattern: RegExp) {
    try {
      await fn();
      expect.fail("expected instruction to fail");
    } catch (e: unknown) {
      expect(String(e)).to.match(pattern);
    }
  }

  function registerAccounts(wallet: PublicKey) {
    return {
      wallet,
      config,
      user: userPda(wallet),
      giesMint,
      desk: deskPda(wallet),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }

  function grantAccounts(recipient: PublicKey) {
    return {
      admin: admin.publicKey,
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

  function createMarketAccounts(id: number, creator: PublicKey) {
    const market = marketPda(id);
    return {
      creator,
      creatorUser: userPda(creator),
      config,
      market,
      vault: vaultPda(market),
      creatorLp: lpPda(market, creator),
      creatorGies: ata(creator),
      giesMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }

  function tradeAccounts(trader: PublicKey, market: PublicKey) {
    return {
      trader,
      config,
      traderUser: userPda(trader),
      market,
      vault: vaultPda(market),
      position: posPda(market, trader),
      traderGies: ata(trader),
      giesMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }

  function lpAccounts(trader: PublicKey, market: PublicKey) {
    return {
      trader,
      config,
      traderUser: userPda(trader),
      market,
      vault: vaultPda(market),
      lp: lpPda(market, trader),
      position: posPda(market, trader),
      desk: deskPda(trader),
      traderGies: ata(trader),
      giesMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }

  before(async () => {
    await airdrop(admin.publicKey, 5e9);
    await airdrop(student.publicKey);
    await airdrop(maker.publicKey);
    await airdrop(outsider.publicKey);
  });

  it("initializes config and the GIES mint", async () => {
    await program.methods
      .initialize()
      .accounts({
        admin: admin.publicKey,
        config,
        giesMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const c = await program.account.config.fetch(config);
    expect(c.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(c.giesMint.toBase58()).to.equal(giesMint.toBase58());
    expect(c.nextMarketId.toNumber()).to.equal(0);
    expect(c.paused).to.equal(false);
    expect(c.starterAmount.eq(new BN(5_000).mul(GIES))).to.equal(true);
    expect(c.deskAmount.eq(new BN(15_000).mul(GIES))).to.equal(true);
  });

  it("bootstraps the deployer as ROLE_ADMIN", async () => {
    await program.methods.registerUser().accounts(registerAccounts(admin.publicKey)).rpc();
    const u = await program.account.user.fetch(userPda(admin.publicKey));
    expect(u.role).to.equal(ROLE_ADMIN);
    expect(u.wallet.toBase58()).to.equal(admin.publicKey.toBase58());
  });

  it("lets the admin mint GIES and seed market 0", async () => {
    await program.methods
      .grantGies(new BN(20_000).mul(GIES))
      .accounts(grantAccounts(admin.publicKey))
      .rpc();

    await expectIxFail(
      () =>
        program.methods
          .createMarket(new BN(1), new BN(1_000).mul(GIES), null, null, null)
          .accounts(createMarketAccounts(1, admin.publicKey))
          .rpc(),
      /MarketIdMismatch|0x1780/i
    );

    await program.methods
      .createMarket(new BN(0), new BN(1_000).mul(GIES), 10_000, null, 2_500)
      .preInstructions([CU])
      .accounts(createMarketAccounts(0, admin.publicKey))
      .rpc();

    const market = marketPda(0);
    const m = await program.account.market.fetch(market);
    expect(m.yesPool.eq(new BN(1_000).mul(GIES))).to.equal(true);
    expect(m.noPool.eq(m.yesPool)).to.equal(true);
    expect(m.vaultCollateral.eq(m.yesPool)).to.equal(true);
    expect(m.status).to.equal(STATUS_OPEN);
    expect(m.lpShares.eq(new BN(1_000).mul(GIES))).to.equal(true);
    expect(m.maxPriceImpactBps).to.equal(10_000);
    expect(m.maxTradeSizeBps).to.equal(2_500);
    const c = await program.account.config.fetch(config);
    expect(c.nextMarketId.toNumber()).to.equal(1);
  });

  it("registers a student, grants a starter pack, and trades YES", async () => {
    await program.methods
      .registerUser()
      .accounts(registerAccounts(student.publicKey))
      .signers([student])
      .rpc();
    const stu = await program.account.user.fetch(userPda(student.publicKey));
    expect(stu.role).to.equal(ROLE_STUDENT);

    await program.methods
      .grantGies(new BN(5_000).mul(GIES))
      .accounts(grantAccounts(student.publicKey))
      .rpc();

    const market = marketPda(0);
    await program.methods
      .buy(OUTCOME_YES, new BN(50).mul(GIES))
      .preInstructions([CU])
      .accounts(tradeAccounts(student.publicKey, market))
      .signers([student])
      .rpc();

    const pos = await program.account.position.fetch(posPda(market, student.publicKey));
    expect(pos.yesAmount.gt(new BN(0))).to.equal(true);
    expect(pos.noAmount.toNumber()).to.equal(0);

    const sellAmt = pos.yesAmount.div(new BN(2));
    await program.methods
      .sell(OUTCOME_YES, sellAmt)
      .preInstructions([CU])
      .accounts(tradeAccounts(student.publicKey, market))
      .signers([student])
      .rpc();

    const after = await program.account.market.fetch(market);
    expect(after.yesPool.eq(after.noPool)).to.equal(false);
    expect(after.cumulativeFees.gt(new BN(0))).to.equal(true);

    const posAfter = await program.account.position.fetch(
      posPda(market, student.publicKey)
    );
    expect(posAfter.yesAmount.eq(pos.yesAmount.sub(sellAmt))).to.equal(true);
  });

  it("rejects student LP and oversized buys while the book is open", async () => {
    const market = marketPda(0);
    await expectIxFail(
      () =>
        program.methods
          .addLiquidity(new BN(10).mul(GIES))
          .preInstructions([CU])
          .accounts(lpAccounts(student.publicKey, market))
          .signers([student])
          .rpc(),
      /Unauthorized|0x1776/i
    );

    await expectIxFail(
      () =>
        program.methods
          .buy(OUTCOME_NO, new BN(600).mul(GIES))
          .preInstructions([CU])
          .accounts(tradeAccounts(student.publicKey, market))
          .signers([student])
          .rpc(),
      /TradeTooLarge|0x1775/i
    );

    await expectIxFail(
      () =>
        program.methods
          .createMarket(new BN(1), new BN(1_000).mul(GIES), null, null, null)
          .accounts(createMarketAccounts(1, student.publicKey))
          .signers([student])
          .rpc(),
      /Unauthorized|0x1776/i
    );
  });

  it("funds a maker desk and round-trips liquidity on market 1", async () => {
    await program.methods
      .registerUser()
      .accounts(registerAccounts(maker.publicKey))
      .signers([maker])
      .rpc();

    await program.methods
      .fundDesk()
      .accounts({
        actor: admin.publicKey,
        actorUser: userPda(admin.publicKey),
        target: userPda(maker.publicKey),
        config,
        giesMint,
        desk: deskPda(maker.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const makerUser = await program.account.user.fetch(userPda(maker.publicKey));
    expect(makerUser.role).to.equal(ROLE_MAKER);

    await program.methods
      .grantGies(new BN(1).mul(GIES))
      .accounts(grantAccounts(maker.publicKey))
      .rpc();

    await program.methods
      .createMarket(new BN(1), new BN(1_000).mul(GIES), null, null, null)
      .preInstructions([CU])
      .accounts(createMarketAccounts(1, admin.publicKey))
      .rpc();

    const market = marketPda(1);
    await program.methods
      .addLiquidity(new BN(100).mul(GIES))
      .preInstructions([CU])
      .accounts(lpAccounts(maker.publicKey, market))
      .signers([maker])
      .rpc();

    const lp = await program.account.lpPosition.fetch(lpPda(market, maker.publicKey));
    expect(lp.shares.gt(new BN(0))).to.equal(true);
    const afterAdd = await program.account.user.fetch(userPda(maker.publicKey));
    expect(afterAdd.openLpCount).to.equal(1);

    await expectIxFail(
      () =>
        program.methods
          .settleDesk()
          .accounts({
            actor: maker.publicKey,
            actorUser: userPda(maker.publicKey),
            target: userPda(maker.publicKey),
            desk: deskPda(maker.publicKey),
            personal: maker.publicKey,
            personalGies: ata(maker.publicKey),
            giesMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([maker])
          .rpc(),
      /OpenLpPositions|0x177c/i
    );

    await program.methods
      .removeLiquidity(lp.shares)
      .preInstructions([CU])
      .accounts(lpAccounts(maker.publicKey, market))
      .signers([maker])
      .rpc();

    const lpAfter = await program.account.lpPosition.fetch(
      lpPda(market, maker.publicKey)
    );
    expect(lpAfter.shares.toNumber()).to.equal(0);
    const afterRemove = await program.account.user.fetch(userPda(maker.publicKey));
    expect(afterRemove.openLpCount).to.equal(0);

    await program.methods
      .settleDesk()
      .accounts({
        actor: maker.publicKey,
        actorUser: userPda(maker.publicKey),
        target: userPda(maker.publicKey),
        desk: deskPda(maker.publicKey),
        personal: maker.publicKey,
        personalGies: ata(maker.publicKey),
        giesMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc();

    const settled = await program.account.user.fetch(userPda(maker.publicKey));
    expect(settled.role).to.equal(ROLE_STUDENT);
  });

  it("pauses trading globally", async () => {
    await program.methods
      .setPaused(true)
      .accounts({ admin: admin.publicKey, config })
      .rpc();

    await expectIxFail(
      () =>
        program.methods
          .buy(OUTCOME_NO, new BN(10).mul(GIES))
          .preInstructions([CU])
          .accounts(tradeAccounts(student.publicKey, marketPda(1)))
          .signers([student])
          .rpc(),
      /Paused|0x1777/i
    );

    await program.methods
      .setPaused(false)
      .accounts({ admin: admin.publicKey, config })
      .rpc();
  });

  it("resolves market 0 and redeems the winning YES bag", async () => {
    const market = marketPda(0);
    const before = await program.account.position.fetch(
      posPda(market, student.publicKey)
    );
    expect(before.yesAmount.gt(new BN(0))).to.equal(true);

    await program.methods
      .resolveMarket(OUTCOME_YES)
      .accounts({
        resolver: admin.publicKey,
        resolverUser: userPda(admin.publicKey),
        market,
      })
      .rpc();

    const resolved = await program.account.market.fetch(market);
    expect(resolved.status).to.equal(STATUS_RESOLVED);
    expect(resolved.outcome).to.equal(OUTCOME_YES);

    await expectIxFail(
      () =>
        program.methods
          .buy(OUTCOME_YES, new BN(10).mul(GIES))
          .preInstructions([CU])
          .accounts(tradeAccounts(student.publicKey, market))
          .signers([student])
          .rpc(),
      /MarketNotOpen|0x1778/i
    );

    await program.methods
      .redeem(OUTCOME_YES)
      .preInstructions([CU])
      .accounts({
        trader: student.publicKey,
        market,
        vault: vaultPda(market),
        position: posPda(market, student.publicKey),
        traderGies: ata(student.publicKey),
        giesMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([student])
      .rpc();

    const pos = await program.account.position.fetch(
      posPda(market, student.publicKey)
    );
    expect(pos.yesAmount.toNumber()).to.equal(0);
    expect(pos.yesCost.toNumber()).to.equal(0);
  });

  it("closes market 1 so new trades stop", async () => {
    const market = marketPda(1);
    await program.methods
      .closeMarket()
      .accounts({
        resolver: admin.publicKey,
        resolverUser: userPda(admin.publicKey),
        market,
      })
      .rpc();
    const m = await program.account.market.fetch(market);
    expect(m.status).to.equal(STATUS_CLOSED);

    await expectIxFail(
      () =>
        program.methods
          .buy(OUTCOME_NO, new BN(10).mul(GIES))
          .preInstructions([CU])
          .accounts(tradeAccounts(student.publicKey, market))
          .signers([student])
          .rpc(),
      /MarketNotOpen|0x1778/i
    );
  });

  it("lets an admin promote a teacher", async () => {
    await program.methods
      .registerUser()
      .accounts(registerAccounts(outsider.publicKey))
      .signers([outsider])
      .rpc();
    await program.methods
      .setRole(ROLE_TEACHER)
      .accounts({
        actor: admin.publicKey,
        actorUser: userPda(admin.publicKey),
        target: userPda(outsider.publicKey),
        desk: deskPda(outsider.publicKey),
        giesMint,
      })
      .rpc();
    const u = await program.account.user.fetch(userPda(outsider.publicKey));
    expect(u.role).to.equal(ROLE_TEACHER);
  });
});
