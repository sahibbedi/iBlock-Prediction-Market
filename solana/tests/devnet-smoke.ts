import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { Ibpm } from "../target/types/ibpm";

const run = process.env.IBPM_DEVNET === "1";
const GIES = new BN(1_000_000);
const OUTCOME_YES = 1;
const CU = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

(run ? describe : describe.skip)("ibpm devnet smoke", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ibpm as Program<Ibpm>;
  const admin = provider.wallet as anchor.Wallet;

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
  function marketPda(id: number | anchor.BN) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(new BN(id).toString()));
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

  it("initializes once, then trades a live market", async () => {
    const existing = await provider.connection.getAccountInfo(config);
    if (!existing) {
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
    }

    const userInfo = await provider.connection.getAccountInfo(userPda(admin.publicKey));
    if (!userInfo) {
      await program.methods
        .registerUser()
        .accounts({
          wallet: admin.publicKey,
          config,
          user: userPda(admin.publicKey),
          giesMint,
          desk: deskPda(admin.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    await program.methods
      .grantGies(new BN(3_000).mul(GIES))
      .accounts({
        admin: admin.publicKey,
        config,
        recipient: admin.publicKey,
        recipientUser: userPda(admin.publicKey),
        giesMint,
        recipientGies: ata(admin.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cfg = await program.account.config.fetch(config);
    const id = cfg.nextMarketId;
    const market = marketPda(id);

    await program.methods
      .createMarket(id, new BN(1_000).mul(GIES), null, null, null)
      .preInstructions([CU])
      .accounts({
        creator: admin.publicKey,
        creatorUser: userPda(admin.publicKey),
        config,
        market,
        vault: vaultPda(market),
        creatorLp: lpPda(market, admin.publicKey),
        creatorGies: ata(admin.publicKey),
        giesMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .buy(OUTCOME_YES, new BN(25).mul(GIES))
      .preInstructions([CU])
      .accounts({
        trader: admin.publicKey,
        config,
        traderUser: userPda(admin.publicKey),
        market,
        vault: vaultPda(market),
        position: posPda(market, admin.publicKey),
        traderGies: ata(admin.publicKey),
        giesMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const pos = await program.account.position.fetch(posPda(market, admin.publicKey));
    expect(pos.yesAmount.gt(new BN(0))).to.equal(true);

    await program.methods
      .resolveMarket(OUTCOME_YES)
      .accounts({
        resolver: admin.publicKey,
        resolverUser: userPda(admin.publicKey),
        market,
      })
      .rpc();

    await program.methods
      .redeem(OUTCOME_YES)
      .preInstructions([CU])
      .accounts({
        trader: admin.publicKey,
        market,
        vault: vaultPda(market),
        position: posPda(market, admin.publicKey),
        traderGies: ata(admin.publicKey),
        giesMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const after = await program.account.position.fetch(posPda(market, admin.publicKey));
    expect(after.yesAmount.toNumber()).to.equal(0);
  });
});
