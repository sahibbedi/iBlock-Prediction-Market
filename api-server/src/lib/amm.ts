/**
 * Fixed-Product Market Maker (FPMM) — fully collateralized.
 *
 * Reserves hold outcome tokens (YES, NO); every token is backed 1-for-1 by GIES
 * in the market vault. The product k = yesPool * noPool is preserved across trades.
 * Price: P_yes = noPool / (yesPool + noPool)   (YES is expensive when it is scarce)
 *
 * BUY  outcome i with collateral P: lock P in the vault, mint (P - fee) complete
 *      sets into the pool, then withdraw outcome i to the buyer so the product
 *      returns to k. Buying i makes i scarcer, which correctly RAISES P_i. The
 *      fee is retained in the vault as surplus (LP value).
 * SELL outcome i (s tokens): the tokens go back into the pool; matched complete
 *      sets are merged to release GIES from the vault, paying the seller net of fee.
 */

/**
 * Retained for display / backward compatibility. Virtual liquidity is no longer
 * used in the trade path — depth comes from real, collateralized reserves.
 */
export function computeEffectivePools(
  yesPool: number,
  noPool: number,
  totalVolume: number,
  virtualLiquidity: number = 0,
  virtualLiquidityDecayVolume: number = 1000
): { effectiveYesPool: number; effectiveNoPool: number; effectiveVirtualPerSide: number } {
  if (virtualLiquidity <= 0 || virtualLiquidityDecayVolume <= 0) {
    return { effectiveYesPool: yesPool, effectiveNoPool: noPool, effectiveVirtualPerSide: 0 };
  }
  const decay = Math.max(0, 1 - totalVolume / virtualLiquidityDecayVolume);
  const effectiveVirtualPerSide = (virtualLiquidity * decay) / 2;
  return {
    effectiveYesPool: yesPool + effectiveVirtualPerSide,
    effectiveNoPool: noPool + effectiveVirtualPerSide,
    effectiveVirtualPerSide,
  };
}

export interface AMMState {
  yesPool: number;
  noPool: number;
}

export interface QuoteResult {
  tokenAmount: number;
  giesCost: number;      // buy: positive (buyer pays); sell: negative (seller receives)
  pricePerToken: number;
  priceImpact: number;
  newYesPrice: number;
  newNoPrice: number;
  newYesPool: number;
  newNoPool: number;
  vaultDelta: number;    // change in vault collateral (+P on buy, -net on sell)
  supplyDelta: number;   // change applied to EACH of YES/NO supply (+minted buy, -merged sell)
}

export function getPrice(yesPool: number, noPool: number): { yesPrice: number; noPrice: number } {
  const total = yesPool + noPool;
  return {
    yesPrice: noPool / total,
    noPrice: yesPool / total,
  };
}

/**
 * Dynamic fee that scales up as the implied probability moves away from 50%,
 * making it progressively more expensive to push toward the extremes.
 */
export function computeDynamicFeeRate(
  yesPool: number,
  noPool: number,
  baseFeeRate: number = 0.02,
  maxFeeRate: number = 0.05
): number {
  const { yesPrice } = getPrice(yesPool, noPool);
  const distance = Math.abs(yesPrice - 0.5);
  const normalizedDistance = distance / 0.5;
  return baseFeeRate + (maxFeeRate - baseFeeRate) * (normalizedDistance * normalizedDistance);
}

/**
 * Quote buying `outcome` with `giesAmount` collateral.
 * Mints (giesAmount - fee) complete sets into the pool and withdraws `outcome`.
 */
export function quoteBuy(
  yesPool: number,
  noPool: number,
  outcome: "yes" | "no",
  giesAmount: number,
  feeRate: number = 0.02
): QuoteResult {
  const feeAmount = giesAmount * feeRate;
  const c = giesAmount - feeAmount; // net collateral minted into complete sets
  const k = yesPool * noPool;

  let newYesPool: number;
  let newNoPool: number;
  let tokenAmount: number;

  if (outcome === "yes") {
    newNoPool = noPool + c;
    newYesPool = k / newNoPool;
    tokenAmount = (yesPool + c) - newYesPool;
  } else {
    newYesPool = yesPool + c;
    newNoPool = k / newYesPool;
    tokenAmount = (noPool + c) - newNoPool;
  }

  const { yesPrice: oldYes, noPrice: oldNo } = getPrice(yesPool, noPool);
  const { yesPrice: newYes, noPrice: newNo } = getPrice(newYesPool, newNoPool);
  const pricePerToken = giesAmount / tokenAmount;
  const midPrice = outcome === "yes" ? oldYes : oldNo;
  const priceImpact = Math.abs(pricePerToken - midPrice) / midPrice;

  return {
    tokenAmount,
    giesCost: giesAmount,
    pricePerToken,
    priceImpact,
    newYesPrice: newYes,
    newNoPrice: newNo,
    newYesPool,
    newNoPool,
    vaultDelta: giesAmount,
    supplyDelta: c,
  };
}

/**
 * Quote buying an exact number of `outcome` tokens (reverse of quoteBuy).
 */
export function quoteBuyExactTokens(
  yesPool: number,
  noPool: number,
  outcome: "yes" | "no",
  tokenAmount: number,
  feeRate: number = 0.02
): QuoteResult {
  const k = yesPool * noPool;
  let c: number;
  let newYesPool: number;
  let newNoPool: number;

  if (outcome === "yes") {
    const m = tokenAmount - yesPool + noPool;
    const x = (m + Math.sqrt(m * m + 4 * k)) / 2; // x = noPool + c
    newNoPool = x;
    c = x - noPool;
    newYesPool = k / x;
  } else {
    const m = tokenAmount - noPool + yesPool;
    const x = (m + Math.sqrt(m * m + 4 * k)) / 2; // x = yesPool + c
    newYesPool = x;
    c = x - yesPool;
    newNoPool = k / x;
  }
  if (c <= 0) throw new Error("Insufficient pool liquidity");
  const giesAmount = c / (1 - feeRate);

  const { yesPrice: oldYes, noPrice: oldNo } = getPrice(yesPool, noPool);
  const { yesPrice: newYes, noPrice: newNo } = getPrice(newYesPool, newNoPool);
  const pricePerToken = giesAmount / tokenAmount;
  const midPrice = outcome === "yes" ? oldYes : oldNo;
  const priceImpact = Math.abs(pricePerToken - midPrice) / midPrice;

  return {
    tokenAmount,
    giesCost: giesAmount,
    pricePerToken,
    priceImpact,
    newYesPrice: newYes,
    newNoPrice: newNo,
    newYesPool,
    newNoPool,
    vaultDelta: giesAmount,
    supplyDelta: c,
  };
}

/**
 * Quote selling `tokenAmount` of `outcome`.
 * Adds the tokens to the pool and merges matched complete sets to release GIES.
 */
export function quoteSell(
  yesPool: number,
  noPool: number,
  outcome: "yes" | "no",
  tokenAmount: number,
  feeRate: number = 0.02
): QuoteResult {
  const k = yesPool * noPool;
  const s = tokenAmount;

  let a: number;
  let b: number;
  if (outcome === "yes") { a = yesPool + s; b = noPool; }
  else { a = noPool + s; b = yesPool; }

  // r = complete sets merged so that the product returns to k
  const r = ((a + b) - Math.sqrt((a - b) * (a - b) + 4 * k)) / 2;

  let newYesPool: number;
  let newNoPool: number;
  if (outcome === "yes") { newYesPool = a - r; newNoPool = b - r; }
  else { newNoPool = a - r; newYesPool = b - r; }

  const giesGross = r;
  const giesNet = giesGross - giesGross * feeRate;

  const { yesPrice: oldYes, noPrice: oldNo } = getPrice(yesPool, noPool);
  const { yesPrice: newYes, noPrice: newNo } = getPrice(newYesPool, newNoPool);
  const pricePerToken = giesNet / s;
  const midPrice = outcome === "yes" ? oldYes : oldNo;
  const priceImpact = Math.abs(pricePerToken - midPrice) / midPrice;

  return {
    tokenAmount: s,
    giesCost: -giesNet,
    pricePerToken,
    priceImpact,
    newYesPrice: newYes,
    newNoPrice: newNo,
    newYesPool,
    newNoPool,
    vaultDelta: -giesNet,
    supplyDelta: -r,
  };
}

export interface SafeguardParams {
  maxPriceImpact: number;
  minPoolDepth: number;
  maxTradeSizePct: number;
}

export interface SafeguardResult {
  warnings: string[];
  isBlocked: boolean;
}

/**
 * Evaluate safeguards for a quote. Operates on the real (post-trade) reserves,
 * so the min-pool-depth check can no longer be fooled by virtual depth.
 */
export function evaluateSafeguards(
  quote: QuoteResult,
  yesPool: number,
  noPool: number,
  tradeGies: number,
  params: SafeguardParams,
  isBootstrapping: boolean = false
): SafeguardResult {
  const warnings: string[] = [];
  let isBlocked = false;

  const impactPct = quote.priceImpact * 100;
  const maxImpactPct = params.maxPriceImpact * 100;

  if (impactPct > maxImpactPct) {
    if (isBootstrapping) {
      warnings.push(`High price impact: ${impactPct.toFixed(1)}% (limit relaxed during bootstrapping)`);
    } else {
      warnings.push(`Trade exceeds maximum allowed price impact (${impactPct.toFixed(1)}% > ${maxImpactPct.toFixed(1)}%)`);
      isBlocked = true;
    }
  } else if (impactPct > 10) {
    warnings.push(`Very high price impact: ${impactPct.toFixed(1)}%`);
  } else if (impactPct > 5) {
    warnings.push(`Elevated price impact: ${impactPct.toFixed(1)}%`);
  }

  const resultingYes = quote.newYesPool;
  const resultingNo = quote.newNoPool;
  if (resultingYes < params.minPoolDepth || resultingNo < params.minPoolDepth) {
    warnings.push(`Trade would reduce pool below minimum depth of ${params.minPoolDepth} GIES`);
    isBlocked = true;
  }

  const totalPool = yesPool + noPool;
  const maxTradeGies = params.maxTradeSizePct * totalPool;
  if (tradeGies > maxTradeGies) {
    warnings.push(`Trade size exceeds ${(params.maxTradeSizePct * 100).toFixed(0)}% of total pool (max ${maxTradeGies.toFixed(2)} GIES)`);
    isBlocked = true;
  }

  return { warnings, isBlocked };
}
