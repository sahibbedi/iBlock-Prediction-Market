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

    pub fn initialize(
        ctx: Context<Initialize>,
        members: [Pubkey; 7],
        member_count: u8,
        routine_threshold: u8,
        resolve_threshold: u8,
    ) -> Result<()> {
        instructions::initialize(
            ctx,
            members,
            member_count,
            routine_threshold,
            resolve_threshold,
        )
    }

    pub fn set_committee(
        ctx: Context<CommitteeConfig>,
        members: [Pubkey; 7],
        member_count: u8,
        routine_threshold: u8,
        resolve_threshold: u8,
    ) -> Result<()> {
        instructions::set_committee(
            ctx,
            members,
            member_count,
            routine_threshold,
            resolve_threshold,
        )
    }

    pub fn set_paused(ctx: Context<CommitteeConfig>, paused: bool) -> Result<()> {
        instructions::set_paused(ctx, paused)
    }

    pub fn set_economics(
        ctx: Context<CommitteeConfig>,
        starter_amount: u64,
        maker_capital: u64,
        fee_base_bps: u16,
        fee_max_bps: u16,
        fee_match_bps: u16,
        reward_budget: u64,
    ) -> Result<()> {
        instructions::set_economics(
            ctx,
            starter_amount,
            maker_capital,
            fee_base_bps,
            fee_max_bps,
            fee_match_bps,
            reward_budget,
        )
    }

    pub fn upgrade_program(ctx: Context<UpgradeProgram>) -> Result<()> {
        instructions::upgrade_program(ctx)
    }

    pub fn enroll(ctx: Context<Enroll>, kind: u8) -> Result<()> {
        instructions::enroll(ctx, kind)
    }

    pub fn set_kind(ctx: Context<UpdateParticipant>, kind: u8) -> Result<()> {
        instructions::set_kind(ctx, kind)
    }

    pub fn set_active(ctx: Context<UpdateParticipant>, active: bool) -> Result<()> {
        instructions::set_active(ctx, active)
    }

    pub fn grant_starter(ctx: Context<GrantGies>) -> Result<()> {
        instructions::grant_starter(ctx)
    }

    pub fn grant_gies(ctx: Context<GrantGies>, amount: u64) -> Result<()> {
        instructions::grant_gies(ctx, amount)
    }

    pub fn mint_to_treasury(ctx: Context<TreasuryMint>, amount: u64) -> Result<()> {
        instructions::mint_to_treasury(ctx, amount)
    }

    pub fn allocate_maker_capital(ctx: Context<MakerCapital>, amount: u64) -> Result<()> {
        instructions::allocate_maker_capital(ctx, amount)
    }

    pub fn clawback_maker_capital(ctx: Context<MakerCapital>, amount: u64) -> Result<()> {
        instructions::clawback_maker_capital(ctx, amount)
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

    pub fn close_market(ctx: Context<MarketAdmin>) -> Result<()> {
        instructions::close_market(ctx)
    }

    pub fn resolve_market(ctx: Context<MarketAdmin>, outcome: u8) -> Result<()> {
        instructions::resolve_market(ctx, outcome)
    }

    pub fn withdraw_protocol_liquidity(
        ctx: Context<ProtocolLiquidity>,
        shares: u64,
    ) -> Result<()> {
        instructions::withdraw_protocol_liquidity(ctx, shares)
    }

    pub fn redeem_protocol(ctx: Context<RedeemProtocol>, outcome: u8) -> Result<()> {
        instructions::redeem_protocol(ctx, outcome)
    }

    pub fn buy(ctx: Context<Trade>, outcome: u8, gies_amount: u64, min_tokens_out: u64) -> Result<()> {
        instructions::buy(ctx, outcome, gies_amount, min_tokens_out)
    }

    pub fn sell(ctx: Context<Trade>, outcome: u8, token_amount: u64, min_gies_out: u64) -> Result<()> {
        instructions::sell(ctx, outcome, token_amount, min_gies_out)
    }

    pub fn set_market_params(ctx: Context<MarketAdmin>, fee_base_bps: u16, fee_max_bps: u16, max_price_impact_bps: u16, min_pool_depth: u64, max_trade_size_bps: u16) -> Result<()> {
        instructions::set_market_params(ctx, fee_base_bps, fee_max_bps, max_price_impact_bps, min_pool_depth, max_trade_size_bps)
    }

    pub fn pay_reward(ctx: Context<PayReward>, claim_id: u64, attributed_fees: u64, evidence_hash: [u8; 32]) -> Result<()> {
        instructions::pay_reward(ctx, claim_id, attributed_fees, evidence_hash)
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
