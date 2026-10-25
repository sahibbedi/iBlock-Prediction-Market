/** Read-only readiness check. Never initializes, mints or trades on a public cluster. */
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { addresses } from "../client/index";
import idl from "../idl/ibpm.json";
import type { Ibpm } from "../idl/ibpm";
const run = process.env.IBPM_DEVNET === "1";
(run ? describe : describe.skip)("campus devnet readiness (read-only)", () => {
  it("has a real committee and committee-controlled upgrade authority", async () => {
    const provider = AnchorProvider.env();
    const program = new Program<Ibpm>(idl as unknown as Ibpm, provider);
    const a = addresses(program.programId);
    const config = await program.account.config.fetch(a.config);
    expect(config.memberCount).to.be.at.least(2);
    expect(config.routineThreshold).to.be.at.least(2);
    expect(config.resolveThreshold).to.be.at.least(config.routineThreshold);
    const programData = PublicKey.findProgramAddressSync([program.programId.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0];
    const info = await provider.connection.getAccountInfo(programData, "confirmed");
    if (!info || info.data.readUInt32LE(0) !== 3 || info.data[12] !== 1) throw new Error("Upgradeable program data is missing");
    expect(new PublicKey(info.data.subarray(13,45)).equals(a.config)).to.equal(true);
  });
});
