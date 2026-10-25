use crate::constants::*;
use crate::math::{FEE_BASE_BPS, FEE_MAX_BPS};
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub members: [Pubkey; MAX_COMMITTEE],
    pub member_count: u8,
    /// Create, enroll, mint, pause-off, close.
    pub routine_threshold: u8,
    /// Resolve, claw back maker capital, change the committee. Always >= routine.
    pub resolve_threshold: u8,
    pub gies_mint: Pubkey,
    pub next_market_id: u64,
    pub paused: bool,
    pub starter_amount: u64,
    pub maker_capital: u64,
    pub fee_base_bps: u16,
    pub fee_max_bps: u16,
    /// Fee-match basis points applied to committee-attested LP fees.
    pub fee_match_bps: u16,
    /// Remaining authorized reward emissions. Decremented atomically on payout.
    pub reward_budget: u64,
    pub bump: u8,
    pub mint_bump: u8,
    pub treasury_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct User {
    pub wallet: Pubkey,
    pub kind: u8,
    pub active: bool,
    pub starter_claimed: bool,
    pub open_lp_count: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub market_id: u64,
    pub creator: Pubkey,
    pub resolver: Pubkey,
    pub status: u8,
    pub outcome: u8,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub vault_collateral: u64,
    pub total_yes_supply: u64,
    pub total_no_supply: u64,
    pub lp_shares: u64,
    pub cumulative_fees: u64,
    pub fee_base_bps: u16,
    pub fee_max_bps: u16,
    pub max_price_impact_bps: u16,
    pub min_pool_depth: u64,
    pub max_trade_size_bps: u16,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Market {
    pub fn default_params() -> (u16, u16, u16, u64, u16) {
        (
            FEE_BASE_BPS,
            FEE_MAX_BPS,
            DEFAULT_MAX_IMPACT_BPS,
            DEFAULT_MIN_POOL_DEPTH,
            DEFAULT_MAX_TRADE_BPS,
        )
    }
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub yes_amount: u64,
    pub no_amount: u64,
    pub yes_cost: u64,
    pub no_cost: u64,
    pub realized_pnl: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct LpPosition {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub shares: u64,
    pub gies_provided: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RewardClaim {
    pub claim_id: u64,
    pub recipient: Pubkey,
    pub attributed_fees: u64,
    pub amount: u64,
    /// Hash of the indexer report identifying the fee interval and attribution.
    pub evidence_hash: [u8; 32],
}
