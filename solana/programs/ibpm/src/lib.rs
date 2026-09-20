use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("EiMn8BEsdfuxEedNGi2vr12cjbKhGpq5Bq5N2ecCdnnM");

#[program]
pub mod ibpm {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::set_paused(ctx, paused)
    }

    pub fn register_user(ctx: Context<RegisterUser>) -> Result<()> {
        instructions::register_user(ctx)
    }

    pub fn grant_gies(ctx: Context<GrantGies>, amount: u64) -> Result<()> {
        instructions::grant_gies(ctx, amount)
    }

    pub fn set_role(ctx: Context<SetRole>, role: u8) -> Result<()> {
        instructions::set_role(ctx, role)
    }

    pub fn fund_desk(ctx: Context<FundDesk>) -> Result<()> {
        instructions::fund_desk(ctx)
    }

    pub fn settle_desk(ctx: Context<SettleDesk>) -> Result<()> {
        instructions::settle_desk(ctx)
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        initial_liquidity: u64,
        max_price_impact_bps: Option<u16>,
        min_pool_depth: Option<u64>,
        max_trade_size_bps: Option<u16>,
    ) -> Result<()> {
        instructions::create_market(
            ctx,
            market_id,
            initial_liquidity,
            max_price_impact_bps,
            min_pool_depth,
            max_trade_size_bps,
        )
    }

    pub fn close_market(ctx: Context<ResolveMarket>) -> Result<()> {
        instructions::close_market(ctx)
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, outcome: u8) -> Result<()> {
        instructions::resolve_market(ctx, outcome)
    }

    pub fn buy(ctx: Context<Trade>, outcome: u8, gies_amount: u64) -> Result<()> {
        instructions::buy(ctx, outcome, gies_amount)
    }

    pub fn sell(ctx: Context<Trade>, outcome: u8, token_amount: u64) -> Result<()> {
        instructions::sell(ctx, outcome, token_amount)
    }

    pub fn add_liquidity(ctx: Context<ModifyLiquidity>, gies_amount: u64) -> Result<()> {
        instructions::add_liquidity(ctx, gies_amount)
    }

    pub fn remove_liquidity(ctx: Context<ModifyLiquidity>, shares: u64) -> Result<()> {
        instructions::remove_liquidity(ctx, shares)
    }

    pub fn redeem(ctx: Context<Redeem>, outcome: u8) -> Result<()> {
        instructions::redeem(ctx, outcome)
    }
}
