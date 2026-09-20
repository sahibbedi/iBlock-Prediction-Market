//! Integer FPMM matching `api-server/src/lib/amm.ts` quote functions
//! (tested solvency model). Fee stays in the vault as surplus; pool
//! reserves are the quoted values. Do not inject fee into both pools.

use crate::error::IbpmError;

pub const BPS: u128 = 10_000;
pub const FEE_BASE_BPS: u16 = 200;
pub const FEE_MAX_BPS: u16 = 500;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Yes,
    No,
}

#[derive(Clone, Copy, Debug)]
pub struct Quote {
    pub token_amount: u64,
    pub gies_amount: u64,
    pub new_yes_pool: u64,
    pub new_no_pool: u64,
    pub vault_delta: i128,
    pub supply_delta: i128,
    pub fee: u64,
    pub fee_bps: u16,
    pub impact_bps: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct Safeguards {
    pub max_price_impact_bps: u16,
    pub min_pool_depth: u64,
    pub max_trade_size_bps: u16,
}

pub fn abs_diff(a: u64, b: u64) -> u64 {
    if a > b {
        a - b
    } else {
        b - a
    }
}

pub fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = x.saturating_add(1) / 2;
    while y < x {
        x = y;
        y = x.saturating_add(n / x) / 2;
    }
    x
}

pub fn dynamic_fee_bps(yes_pool: u64, no_pool: u64, base: u16, max: u16) -> Result<u16, IbpmError> {
    let total = (yes_pool as u128).checked_add(no_pool as u128).ok_or(IbpmError::MathOverflow)?;
    if total == 0 {
        return Err(IbpmError::EmptyPool);
    }
    let diff = abs_diff(yes_pool, no_pool) as u128;
    let span = (max as u128).saturating_sub(base as u128);
    let extra = span
        .checked_mul(diff)
        .and_then(|v| v.checked_mul(diff))
        .and_then(|v| v.checked_div(total.checked_mul(total).ok_or(IbpmError::MathOverflow).ok()?))
        .ok_or(IbpmError::MathOverflow)?;
    Ok(base.saturating_add(extra as u16))
}

fn apply_fee(amount: u64, fee_bps: u16) -> Result<(u64, u64), IbpmError> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .and_then(|v| v.checked_div(BPS))
        .ok_or(IbpmError::MathOverflow)? as u64;
    let net = amount.checked_sub(fee).ok_or(IbpmError::MathOverflow)?;
    Ok((net, fee))
}

fn impact_bps(gies: u64, tokens: u64, mid_num: u64, mid_den: u64) -> Result<u64, IbpmError> {
    if tokens == 0 || mid_num == 0 || mid_den == 0 {
        return Err(IbpmError::InvalidAmount);
    }
    let gies = gies as u128;
    let tokens = tokens as u128;
    let mid_num = mid_num as u128;
    let mid_den = mid_den as u128;
    let left = gies.checked_mul(mid_den).ok_or(IbpmError::MathOverflow)?;
    let right = tokens.checked_mul(mid_num).ok_or(IbpmError::MathOverflow)?;
    let num = if left > right { left - right } else { right - left };
    let den = tokens.checked_mul(mid_num).ok_or(IbpmError::MathOverflow)?;
    Ok((num.checked_mul(BPS).ok_or(IbpmError::MathOverflow)? / den) as u64)
}

pub fn quote_buy(
    yes_pool: u64,
    no_pool: u64,
    outcome: Outcome,
    gies_amount: u64,
    fee_bps: u16,
) -> Result<Quote, IbpmError> {
    if gies_amount == 0 || yes_pool == 0 || no_pool == 0 {
        return Err(IbpmError::InvalidAmount);
    }
    let (c, fee) = apply_fee(gies_amount, fee_bps)?;
    if c == 0 {
        return Err(IbpmError::InvalidAmount);
    }
    let k = (yes_pool as u128)
        .checked_mul(no_pool as u128)
        .ok_or(IbpmError::MathOverflow)?;

    let (new_yes, new_no, token_amount) = match outcome {
        Outcome::Yes => {
            let new_no = (no_pool as u128)
                .checked_add(c as u128)
                .ok_or(IbpmError::MathOverflow)?;
            let new_yes = k.checked_div(new_no).ok_or(IbpmError::EmptyPool)?;
            if new_yes == 0 {
                return Err(IbpmError::EmptyPool);
            }
            let minted = (yes_pool as u128)
                .checked_add(c as u128)
                .ok_or(IbpmError::MathOverflow)?;
            let tokens = minted.checked_sub(new_yes).ok_or(IbpmError::MathOverflow)?;
            (new_yes as u64, new_no as u64, tokens as u64)
        }
        Outcome::No => {
            let new_yes = (yes_pool as u128)
                .checked_add(c as u128)
                .ok_or(IbpmError::MathOverflow)?;
            let new_no = k.checked_div(new_yes).ok_or(IbpmError::EmptyPool)?;
            if new_no == 0 {
                return Err(IbpmError::EmptyPool);
            }
            let minted = (no_pool as u128)
                .checked_add(c as u128)
                .ok_or(IbpmError::MathOverflow)?;
            let tokens = minted.checked_sub(new_no).ok_or(IbpmError::MathOverflow)?;
            (new_yes as u64, new_no as u64, tokens as u64)
        }
    };
    if token_amount == 0 {
        return Err(IbpmError::InvalidAmount);
    }

    let total = (yes_pool as u128) + (no_pool as u128);
    let mid_num = match outcome {
        Outcome::Yes => no_pool,
        Outcome::No => yes_pool,
    };
    let impact = impact_bps(gies_amount, token_amount, mid_num, total as u64)?;

    Ok(Quote {
        token_amount,
        gies_amount,
        new_yes_pool: new_yes,
        new_no_pool: new_no,
        vault_delta: gies_amount as i128,
        supply_delta: c as i128,
        fee,
        fee_bps,
        impact_bps: impact,
    })
}

pub fn quote_sell(
    yes_pool: u64,
    no_pool: u64,
    outcome: Outcome,
    token_amount: u64,
    fee_bps: u16,
) -> Result<Quote, IbpmError> {
    if token_amount == 0 || yes_pool == 0 || no_pool == 0 {
        return Err(IbpmError::InvalidAmount);
    }
    let k = (yes_pool as u128)
        .checked_mul(no_pool as u128)
        .ok_or(IbpmError::MathOverflow)?;
    let s = token_amount as u128;
    let (a, b) = match outcome {
        Outcome::Yes => (yes_pool as u128 + s, no_pool as u128),
        Outcome::No => (no_pool as u128 + s, yes_pool as u128),
    };
    let diff = if a > b { a - b } else { b - a };
    let disc = diff
        .checked_mul(diff)
        .and_then(|v| v.checked_add(k.checked_mul(4).ok_or(IbpmError::MathOverflow).ok()?))
        .ok_or(IbpmError::MathOverflow)?;
    let root = isqrt(disc);
    let r = a.checked_add(b).ok_or(IbpmError::MathOverflow)?.saturating_sub(root) / 2;
    if r == 0 || r > a || r > b {
        return Err(IbpmError::InvalidAmount);
    }
    let (new_yes, new_no) = match outcome {
        Outcome::Yes => (a - r, b - r),
        Outcome::No => (b - r, a - r),
    };
    if new_yes == 0 || new_no == 0 {
        return Err(IbpmError::EmptyPool);
    }
    let gies_gross = r as u64;
    let (gies_net, fee) = apply_fee(gies_gross, fee_bps)?;
    if gies_net == 0 {
        return Err(IbpmError::InvalidAmount);
    }

    let total = (yes_pool as u128) + (no_pool as u128);
    let mid_num = match outcome {
        Outcome::Yes => no_pool,
        Outcome::No => yes_pool,
    };
    let impact = impact_bps(gies_net, token_amount, mid_num, total as u64)?;

    Ok(Quote {
        token_amount,
        gies_amount: gies_net,
        new_yes_pool: new_yes as u64,
        new_no_pool: new_no as u64,
        vault_delta: -(gies_net as i128),
        supply_delta: -(r as i128),
        fee,
        fee_bps,
        impact_bps: impact,
    })
}

pub fn check_safeguards(
    quote: &Quote,
    yes_pool: u64,
    no_pool: u64,
    trade_gies: u64,
    params: Safeguards,
) -> Result<(), IbpmError> {
    if quote.impact_bps > params.max_price_impact_bps as u64 {
        return Err(IbpmError::PriceImpactTooHigh);
    }
    if quote.new_yes_pool < params.min_pool_depth || quote.new_no_pool < params.min_pool_depth {
        return Err(IbpmError::PoolTooShallow);
    }
    let total = (yes_pool as u128)
        .checked_add(no_pool as u128)
        .ok_or(IbpmError::MathOverflow)?;
    let max_trade = total
        .checked_mul(params.max_trade_size_bps as u128)
        .and_then(|v| v.checked_div(BPS))
        .ok_or(IbpmError::MathOverflow)?;
    if trade_gies as u128 > max_trade {
        return Err(IbpmError::TradeTooLarge);
    }
    Ok(())
}

/// Ratio-preserving LP add. Price is unchanged. Leftover outcome tokens
/// return to the LP. Shares minted pro-rata to `max(yes, no)`.
pub fn quote_lp_add(
    yes_pool: u64,
    no_pool: u64,
    total_shares: u64,
    gies_amount: u64,
) -> Result<(u64, u64, u64, u64, u64), IbpmError> {
    if gies_amount == 0 {
        return Err(IbpmError::InvalidAmount);
    }
    let f = gies_amount as u128;
    let yes = yes_pool as u128;
    let no = no_pool as u128;
    let weight = yes.max(no);
    if weight == 0 {
        return Err(IbpmError::EmptyPool);
    }
    let yes_add = f.checked_mul(yes).ok_or(IbpmError::MathOverflow)? / weight;
    let no_add = f.checked_mul(no).ok_or(IbpmError::MathOverflow)? / weight;
    let yes_back = f.checked_sub(yes_add).ok_or(IbpmError::MathOverflow)?;
    let no_back = f.checked_sub(no_add).ok_or(IbpmError::MathOverflow)?;
    let shares = if total_shares == 0 {
        gies_amount
    } else {
        (f.checked_mul(total_shares as u128).ok_or(IbpmError::MathOverflow)? / weight) as u64
    };
    if shares == 0 {
        return Err(IbpmError::InvalidAmount);
    }
    Ok((
        yes_add as u64,
        no_add as u64,
        yes_back as u64,
        no_back as u64,
        shares,
    ))
}

pub fn quote_lp_remove(
    yes_pool: u64,
    no_pool: u64,
    total_shares: u64,
    shares: u64,
) -> Result<(u64, u64, u64, u64, u64), IbpmError> {
    if shares == 0 || total_shares == 0 || shares > total_shares {
        return Err(IbpmError::InvalidAmount);
    }
    let yes_out = (yes_pool as u128)
        .checked_mul(shares as u128)
        .ok_or(IbpmError::MathOverflow)?
        / total_shares as u128;
    let no_out = (no_pool as u128)
        .checked_mul(shares as u128)
        .ok_or(IbpmError::MathOverflow)?
        / total_shares as u128;
    let matched = yes_out.min(no_out);
    Ok((
        yes_out as u64,
        no_out as u64,
        matched as u64,
        (yes_out - matched) as u64,
        (no_out - matched) as u64,
    ))
}

pub fn yes_price_bps(yes_pool: u64, no_pool: u64) -> Result<u64, IbpmError> {
    let total = (yes_pool as u128)
        .checked_add(no_pool as u128)
        .ok_or(IbpmError::MathOverflow)?;
    if total == 0 {
        return Err(IbpmError::EmptyPool);
    }
    Ok(((no_pool as u128) * BPS / total) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GIES: u64 = 1_000_000;
    const POOL: u64 = 1_000 * GIES;

    fn s() -> Safeguards {
        Safeguards {
            max_price_impact_bps: 10_000,
            min_pool_depth: 1,
            max_trade_size_bps: 10_000,
        }
    }

    #[test]
    fn buying_yes_raises_yes_price() {
        let q = quote_buy(POOL, POOL, Outcome::Yes, 100 * GIES, FEE_BASE_BPS).unwrap();
        assert!(yes_price_bps(q.new_yes_pool, q.new_no_pool).unwrap() > 5_000);
    }

    #[test]
    fn buying_no_lowers_yes_price() {
        let q = quote_buy(POOL, POOL, Outcome::No, 100 * GIES, FEE_BASE_BPS).unwrap();
        assert!(yes_price_bps(q.new_yes_pool, q.new_no_pool).unwrap() < 5_000);
    }

    #[test]
    fn buy_does_not_increase_k() {
        let q = quote_buy(POOL, POOL, Outcome::Yes, 137 * GIES, FEE_BASE_BPS).unwrap();
        let k0 = (POOL as u128) * (POOL as u128);
        let k1 = (q.new_yes_pool as u128) * (q.new_no_pool as u128);
        assert!(k1 <= k0);
        assert!(k0 - k1 < k0 / 1_000_000);
    }

    #[test]
    fn buy_locks_full_collateral_mints_net_sets() {
        let q = quote_buy(POOL, POOL, Outcome::Yes, 100 * GIES, FEE_BASE_BPS).unwrap();
        assert_eq!(q.vault_delta, 100 * GIES as i128);
        assert_eq!(q.supply_delta, 98 * GIES as i128);
        assert_eq!(q.fee, 2 * GIES);
    }

    #[test]
    fn sell_after_buy_does_not_create_money() {
        let buy = quote_buy(POOL, POOL, Outcome::Yes, 100 * GIES, FEE_BASE_BPS).unwrap();
        let sell = quote_sell(
            buy.new_yes_pool,
            buy.new_no_pool,
            Outcome::Yes,
            buy.token_amount,
            FEE_BASE_BPS,
        )
        .unwrap();
        assert!(sell.gies_amount < 100 * GIES);
        assert!(sell.gies_amount > 90 * GIES);
    }

    #[test]
    fn selling_yes_lowers_yes_price() {
        let buy = quote_buy(POOL, POOL, Outcome::Yes, 100 * GIES, FEE_BASE_BPS).unwrap();
        let before = yes_price_bps(buy.new_yes_pool, buy.new_no_pool).unwrap();
        let sell = quote_sell(
            buy.new_yes_pool,
            buy.new_no_pool,
            Outcome::Yes,
            buy.token_amount,
            FEE_BASE_BPS,
        )
        .unwrap();
        assert!(yes_price_bps(sell.new_yes_pool, sell.new_no_pool).unwrap() < before);
    }

    #[test]
    fn fee_is_base_at_fifty_and_rises_toward_max() {
        assert_eq!(
            dynamic_fee_bps(POOL, POOL, FEE_BASE_BPS, FEE_MAX_BPS).unwrap(),
            FEE_BASE_BPS
        );
        let skewed = dynamic_fee_bps(100 * GIES, 900 * GIES, FEE_BASE_BPS, FEE_MAX_BPS).unwrap();
        assert!(skewed > FEE_BASE_BPS);
        assert!(skewed <= FEE_MAX_BPS);
    }

    #[test]
    fn lp_add_does_not_move_price() {
        let (yes_add, no_add, yes_back, no_back, shares) =
            quote_lp_add(POOL, POOL, POOL, 500 * GIES).unwrap();
        assert_eq!(yes_add, 500 * GIES);
        assert_eq!(no_add, 500 * GIES);
        assert_eq!(yes_back, 0);
        assert_eq!(no_back, 0);
        assert_eq!(shares, 500 * GIES);
        let before = yes_price_bps(POOL, POOL).unwrap();
        let after = yes_price_bps(POOL + yes_add, POOL + no_add).unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn lp_add_on_skewed_pool_returns_leftover_tokens() {
        let yes = 700 * GIES;
        let no = 300 * GIES;
        let (yes_add, no_add, yes_back, no_back, _) = quote_lp_add(yes, no, yes, 70 * GIES).unwrap();
        assert_eq!(yes_add + yes_back, 70 * GIES);
        assert_eq!(no_add + no_back, 70 * GIES);
        let before = yes_price_bps(yes, no).unwrap();
        let after = yes_price_bps(yes + yes_add, no + no_add).unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn lp_remove_merges_matched_sets() {
        let (yes_out, no_out, matched, yes_left, no_left) =
            quote_lp_remove(POOL, POOL, POOL, 250 * GIES).unwrap();
        assert_eq!(yes_out, 250 * GIES);
        assert_eq!(no_out, 250 * GIES);
        assert_eq!(matched, 250 * GIES);
        assert_eq!(yes_left, 0);
        assert_eq!(no_left, 0);
    }

    #[test]
    fn safeguard_blocks_oversized_trade() {
        let q = quote_buy(POOL, POOL, Outcome::Yes, 100 * GIES, FEE_BASE_BPS).unwrap();
        let err = check_safeguards(
            &q,
            POOL,
            POOL,
            100 * GIES,
            Safeguards {
                max_price_impact_bps: 10_000,
                min_pool_depth: 1,
                max_trade_size_bps: 100,
            },
        )
        .unwrap_err();
        assert!(matches!(err, IbpmError::TradeTooLarge));
    }

    #[test]
    fn property_random_trades_stay_solvent() {
        let mut rng: u32 = 12345;
        let mut rand = || {
            rng = rng.wrapping_mul(1_103_515_245).wrapping_add(12345);
            (rng as f64) / (u32::MAX as f64)
        };
        let mut y = POOL;
        let mut n = POOL;
        let mut vault: i128 = POOL as i128;
        let mut sup_y: i128 = POOL as i128;
        let mut sup_n: i128 = POOL as i128;
        let mut user_yes: u64 = 0;
        let mut user_no: u64 = 0;
        let params = s();

        for i in 0..5_000u32 {
            let outcome = if rand() < 0.5 { Outcome::Yes } else { Outcome::No };
            if rand() < 0.6 {
                let amt = GIES + ((rand() * 120.0) as u64 * GIES / 1);
                let Ok(q) = quote_buy(y, n, outcome, amt.max(GIES), FEE_BASE_BPS) else {
                    continue;
                };
                if check_safeguards(&q, y, n, q.gies_amount, params).is_err() {
                    continue;
                }
                y = q.new_yes_pool;
                n = q.new_no_pool;
                vault += q.vault_delta;
                sup_y += q.supply_delta;
                sup_n += q.supply_delta;
                match outcome {
                    Outcome::Yes => user_yes += q.token_amount,
                    Outcome::No => user_no += q.token_amount,
                }
            } else {
                let held = match outcome {
                    Outcome::Yes => user_yes,
                    Outcome::No => user_no,
                };
                if held < GIES {
                    continue;
                }
                let s_amt = GIES + (((rand() * (held - GIES) as f64) as u64).min(held - GIES));
                if s_amt == 0 {
                    continue;
                }
                let Ok(q) = quote_sell(y, n, outcome, s_amt, FEE_BASE_BPS) else {
                    continue;
                };
                y = q.new_yes_pool;
                n = q.new_no_pool;
                vault += q.vault_delta;
                sup_y += q.supply_delta;
                sup_n += q.supply_delta;
                match outcome {
                    Outcome::Yes => user_yes -= s_amt,
                    Outcome::No => user_no -= s_amt,
                }
            }
            assert!(y > 0 && n > 0, "reserves @ {i}");
            assert!((sup_y - sup_n).abs() <= 1, "complete-set conservation @ {i}");
            assert!(vault + 1 >= sup_y.max(sup_n), "solvency vault>=supply @ {i}");
            let yes_cons = (y as i128) + (user_yes as i128) - sup_y;
            let no_cons = (n as i128) + (user_no as i128) - sup_n;
            assert!(yes_cons.abs() <= 2, "YES conservation @ {i}: {yes_cons}");
            assert!(no_cons.abs() <= 2, "NO conservation @ {i}: {no_cons}");
        }
    }
}
