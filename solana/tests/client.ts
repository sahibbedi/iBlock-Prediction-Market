import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import { gies, formatGies, u64, addresses, committeeSigners } from "../client/index";
describe("frontend integration helpers", () => {
  it("keeps six-decimal GIES amounts exact, including beyond JS safe integers", () => {
    expect(gies("9007199254.740993").toString()).to.equal("9007199254740993");
    expect(formatGies(gies("12.000001"))).to.equal("12.000001");
    for (const value of ["1.0000001", "-1", "NaN", "1e3", "18446744073709551616"]) expect(() => gies(value)).to.throw();
  });
  it("derives market IDs as u64 little endian", () => {
    expect(u64(257n).toString("hex")).to.equal("0101000000000000");
    expect(() => u64(-1n)).to.throw();
    const a=addresses(); expect(a.market(0n).equals(a.market(1n))).to.equal(false);
  });
  it("deduplicates additional committee signers", () => {
    const a=PublicKey.unique(), b=PublicKey.unique();
    expect(committeeSigners(a,[a,b,b]).length).to.equal(1);
  });
});
