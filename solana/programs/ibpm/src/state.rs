use crate::constants::*;
use crate::math::{FEE_BASE_BPS, FEE_MAX_BPS};
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub gies_mint: Pubkey,
    pub next_market_id: u64,
    pub paused: bool,
    pub starter_amount: u64,
    pub desk_amount: u64,
    pub bump: u8,
    pub mint_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct User {
    pub wallet: Pubkey,
    pub role: u8,
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
