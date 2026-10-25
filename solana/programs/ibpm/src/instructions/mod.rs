use crate::constants::*;
use crate::error::IbpmError;
use crate::math::{self, Outcome, Safeguards};
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

pub mod helpers;
use helpers::*;

fn mint_with_config<'info>(
    token_program: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    config: AccountInfo<'info>,
    bump: u8,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            token_program,
            MintTo {
                mint,
                to,
                authority: config,
            },
            &[seeds],
        ),
        amount,
    )
}

fn auth_routine(ctx_payer: Pubkey, config: &Config, remaining: &[AccountInfo]) -> Result<()> {
    require_committee(config, ctx_payer, remaining, config.routine_threshold)
}

fn auth_resolve(ctx_payer: Pubkey, config: &Config, remaining: &[AccountInfo]) -> Result<()> {
    require_committee(config, ctx_payer, remaining, config.resolve_threshold)
}

pub fn initialize(
    ctx: Context<Initialize>,
    members: [Pubkey; MAX_COMMITTEE],
    member_count: u8,
    routine_threshold: u8,
    resolve_threshold: u8,
) -> Result<()> {
    require!(ctx.accounts.program_data.upgrade_authority_address == Some(ctx.accounts.payer.key()), IbpmError::Unauthorized);
    validate_committee(&members, member_count, routine_threshold, resolve_threshold)?;
    require!(
        members[..member_count as usize].contains(&ctx.accounts.payer.key()),
        IbpmError::NotCommittee
    );
    let config = &mut ctx.accounts.config;
    config.members = members;
    config.member_count = member_count;
    config.routine_threshold = routine_threshold;
    config.resolve_threshold = resolve_threshold;
    config.gies_mint = ctx.accounts.gies_mint.key();
    config.next_market_id = 0;
    config.paused = false;
    config.starter_amount = STARTER_AMOUNT;
    config.maker_capital = MAKER_CAPITAL;
    config.fee_base_bps = crate::math::FEE_BASE_BPS;
    config.fee_max_bps = crate::math::FEE_MAX_BPS;
    config.fee_match_bps = 0;
    config.reward_budget = 0;
    config.bump = ctx.bumps.config;
    config.mint_bump = ctx.bumps.gies_mint;
    config.treasury_bump = ctx.bumps.treasury;
    Ok(())
}

pub fn set_committee(
    ctx: Context<CommitteeConfig>,
    members: [Pubkey; MAX_COMMITTEE],
    member_count: u8,
    routine_threshold: u8,
    resolve_threshold: u8,
) -> Result<()> {
    auth_resolve(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    validate_committee(&members, member_count, routine_threshold, resolve_threshold)?;
    let config = &mut ctx.accounts.config;
    config.members = members;
    config.member_count = member_count;
    config.routine_threshold = routine_threshold;
    config.resolve_threshold = resolve_threshold;
    Ok(())
}

pub fn set_paused(ctx: Context<CommitteeConfig>, paused: bool) -> Result<()> {
    let threshold = if paused {
        1
    } else {
        ctx.accounts.config.routine_threshold
    };
    require_committee(
        &ctx.accounts.config,
        ctx.accounts.payer.key(),
        ctx.remaining_accounts,
        threshold,
    )?;
    ctx.accounts.config.paused = paused;
    Ok(())
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
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require!(starter_amount > 0 && maker_capital > 0, IbpmError::InvalidAmount);
    require!(
        fee_base_bps <= fee_max_bps && fee_max_bps <= 1_000,
        IbpmError::InvalidAmount
    );
    require!(fee_match_bps <= 10_000, IbpmError::InvalidAmount);
    let config = &mut ctx.accounts.config;
    config.starter_amount = starter_amount;
    config.maker_capital = maker_capital;
    config.fee_base_bps = fee_base_bps;
    config.fee_max_bps = fee_max_bps;
    config.fee_match_bps = fee_match_bps;
    config.reward_budget = reward_budget;
    Ok(())
}

pub fn enroll(ctx: Context<Enroll>, kind: u8) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require_kind(kind)?;
    require!(ctx.accounts.wallet.key() != Pubkey::default(), IbpmError::InvalidAmount);
    let user = &mut ctx.accounts.user;
    user.wallet = ctx.accounts.wallet.key();
    user.kind = kind;
    user.active = true;
    user.starter_claimed = false;
    user.open_lp_count = 0;
    user.bump = ctx.bumps.user;
    Ok(())
}

pub fn set_kind(ctx: Context<UpdateParticipant>, kind: u8) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require_kind(kind)?;
    if kind == KIND_MAKER {
        require!(ctx.accounts.user.active, IbpmError::Inactive);
    }
    if ctx.accounts.user.kind == KIND_MAKER && kind == KIND_TRADER {
        require!(ctx.accounts.user.open_lp_count == 0, IbpmError::OpenLpPositions);
        require!(ctx.accounts.desk.amount == 0, IbpmError::DeskNotEmpty);
    }
    ctx.accounts.user.kind = kind;
    Ok(())
}

pub fn set_active(ctx: Context<UpdateParticipant>, active: bool) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    ctx.accounts.user.active = active;
    Ok(())
}

pub fn grant_starter(ctx: Context<GrantGies>) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require_active(&ctx.accounts.recipient_user)?;
    require!(
        !ctx.accounts.recipient_user.starter_claimed,
        IbpmError::StarterAlreadyClaimed
    );
    let amount = ctx.accounts.config.starter_amount;
    let bump = ctx.accounts.config.bump;
    mint_with_config(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.gies_mint.to_account_info(),
        ctx.accounts.recipient_gies.to_account_info(),
        ctx.accounts.config.to_account_info(),
        bump,
        amount,
    )?;
    ctx.accounts.recipient_user.starter_claimed = true;
    Ok(())
}

pub fn grant_gies(ctx: Context<GrantGies>, amount: u64) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require!(amount > 0, IbpmError::InvalidAmount);
    require_active(&ctx.accounts.recipient_user)?;
    let bump = ctx.accounts.config.bump;
    mint_with_config(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.gies_mint.to_account_info(),
        ctx.accounts.recipient_gies.to_account_info(),
        ctx.accounts.config.to_account_info(),
        bump,
        amount,
    )
}

pub fn mint_to_treasury(ctx: Context<TreasuryMint>, amount: u64) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require!(amount > 0, IbpmError::InvalidAmount);
    let bump = ctx.accounts.config.bump;
    mint_with_config(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.gies_mint.to_account_info(),
        ctx.accounts.treasury.to_account_info(),
        ctx.accounts.config.to_account_info(),
        bump,
        amount,
    )
}

pub fn allocate_maker_capital(ctx: Context<MakerCapital>, amount: u64) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require!(amount > 0, IbpmError::InvalidAmount);
    require_active(&ctx.accounts.user)?;
    require!(ctx.accounts.user.kind == KIND_MAKER, IbpmError::NotMaker);
    let bump = ctx.accounts.config.bump;
    mint_with_config(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.gies_mint.to_account_info(),
        ctx.accounts.desk.to_account_info(),
        ctx.accounts.config.to_account_info(),
        bump,
        amount,
    )
}

pub fn clawback_maker_capital(ctx: Context<MakerCapital>, amount: u64) -> Result<()> {
    auth_resolve(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require!(amount > 0, IbpmError::InvalidAmount);
    require!(ctx.accounts.desk.amount >= amount, IbpmError::InsufficientGies);
    let wallet = ctx.accounts.user.wallet;
    let bump = ctx.accounts.user.bump;
    let seeds: &[&[u8]] = &[USER_SEED, wallet.as_ref(), &[bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.desk.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

pub fn create_market(
    ctx: Context<CreateMarket>,
    market_id: u64,
    initial_liquidity: u64,
    max_price_impact_bps: Option<u16>,
    min_pool_depth: Option<u64>,
    max_trade_size_bps: Option<u16>,
) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require_not_paused(&ctx.accounts.config)?;
    require!(
        market_id == ctx.accounts.config.next_market_id,
        IbpmError::MarketIdMismatch
    );
    require!(initial_liquidity > 0, IbpmError::InvalidAmount);
    require!(
        ctx.accounts.treasury.amount >= initial_liquidity,
        IbpmError::InsufficientGies
    );

    let bump = ctx.accounts.config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        initial_liquidity,
    )?;

    let (_, _, def_impact, def_depth, def_trade) = Market::default_params();
    let fee_base = ctx.accounts.config.fee_base_bps;
    let fee_max = ctx.accounts.config.fee_max_bps;
    let config_key = ctx.accounts.config.key();

    let market = &mut ctx.accounts.market;
    market.market_id = market_id;
    market.creator = config_key;
    market.resolver = config_key;
    market.status = STATUS_OPEN;
    market.outcome = OUTCOME_NONE;
    market.yes_pool = initial_liquidity;
    market.no_pool = initial_liquidity;
    market.vault_collateral = initial_liquidity;
    market.total_yes_supply = initial_liquidity;
    market.total_no_supply = initial_liquidity;
    market.lp_shares = initial_liquidity;
    market.cumulative_fees = 0;
    market.fee_base_bps = fee_base;
    market.fee_max_bps = fee_max;
    market.max_price_impact_bps = max_price_impact_bps.unwrap_or(def_impact);
    market.min_pool_depth = min_pool_depth.unwrap_or(def_depth);
    market.max_trade_size_bps = max_trade_size_bps.unwrap_or(def_trade);
    validate_market_params(fee_base, fee_max, market.max_price_impact_bps, market.min_pool_depth, market.max_trade_size_bps)?;
    market.bump = ctx.bumps.market;
    market.vault_bump = ctx.bumps.vault;

    let lp = &mut ctx.accounts.protocol_lp;
    lp.market = market.key();
    lp.owner = config_key;
    lp.shares = initial_liquidity;
    lp.gies_provided = initial_liquidity;
    lp.bump = ctx.bumps.protocol_lp;

    ctx.accounts.config.next_market_id = market_id
        .checked_add(1)
        .ok_or(IbpmError::MathOverflow)?;
    Ok(())
}

pub fn close_market(ctx: Context<MarketAdmin>) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require!(
        ctx.accounts.market.status == STATUS_OPEN,
        IbpmError::MarketNotOpen
    );
    ctx.accounts.market.status = STATUS_CLOSED;
    Ok(())
}

pub fn resolve_market(ctx: Context<MarketAdmin>, outcome: u8) -> Result<()> {
    auth_resolve(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require!(
        ctx.accounts.market.status != STATUS_RESOLVED,
        IbpmError::AlreadyResolved
    );
    require!(
        outcome == OUTCOME_YES || outcome == OUTCOME_NO,
        IbpmError::InvalidOutcome
    );
    ctx.accounts.market.status = STATUS_RESOLVED;
    ctx.accounts.market.outcome = outcome;
    Ok(())
}

fn market_safeguards(market: &Market) -> Safeguards {
    Safeguards {
        max_price_impact_bps: market.max_price_impact_bps,
        min_pool_depth: market.min_pool_depth,
        max_trade_size_bps: market.max_trade_size_bps,
    }
}

fn apply_supply_delta(market: &mut Market, delta: i128) -> Result<()> {
    if delta >= 0 {
        let d = delta as u64;
        market.total_yes_supply = market
            .total_yes_supply
            .checked_add(d)
            .ok_or(IbpmError::MathOverflow)?;
        market.total_no_supply = market
            .total_no_supply
            .checked_add(d)
            .ok_or(IbpmError::MathOverflow)?;
    } else {
        let d = (-delta) as u64;
        market.total_yes_supply = market
            .total_yes_supply
            .checked_sub(d)
            .ok_or(IbpmError::MathOverflow)?;
        market.total_no_supply = market
            .total_no_supply
            .checked_sub(d)
            .ok_or(IbpmError::MathOverflow)?;
    }
    Ok(())
}

pub fn buy(ctx: Context<Trade>, outcome: u8, gies_amount: u64, min_tokens_out: u64) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    require_open(&ctx.accounts.market)?;
    require_active(&ctx.accounts.trader_user)?;
    let side = outcome_from_u8(outcome)?;
    let fee_bps = math::dynamic_fee_bps(
        ctx.accounts.market.yes_pool,
        ctx.accounts.market.no_pool,
        ctx.accounts.market.fee_base_bps,
        ctx.accounts.market.fee_max_bps,
    )?;
    let quote = math::quote_buy(
        ctx.accounts.market.yes_pool,
        ctx.accounts.market.no_pool,
        side,
        gies_amount,
        fee_bps,
    )?;
    require!(quote.token_amount >= min_tokens_out, IbpmError::SlippageExceeded);
    math::check_safeguards(
        &quote,
        ctx.accounts.market.yes_pool,
        ctx.accounts.market.no_pool,
        gies_amount,
        market_safeguards(&ctx.accounts.market),
    )?;
    require!(
        ctx.accounts.trader_gies.amount >= gies_amount,
        IbpmError::InsufficientGies
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.trader_gies.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        gies_amount,
    )?;

    let market = &mut ctx.accounts.market;
    // Reinvest fee collateral as complete sets so LP reserves earn the fee.
    market.yes_pool = quote.new_yes_pool.checked_add(quote.fee).ok_or(IbpmError::MathOverflow)?;
    market.no_pool = quote.new_no_pool.checked_add(quote.fee).ok_or(IbpmError::MathOverflow)?;
    market.vault_collateral = market
        .vault_collateral
        .checked_add(gies_amount)
        .ok_or(IbpmError::MathOverflow)?;
    market.cumulative_fees = market
        .cumulative_fees
        .checked_add(quote.fee)
        .ok_or(IbpmError::MathOverflow)?;
    apply_supply_delta(market, quote.supply_delta.checked_add(quote.fee as i128).ok_or(IbpmError::MathOverflow)?)?;

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.market = market.key();
        position.owner = ctx.accounts.trader.key();
        position.bump = ctx.bumps.position;
    }
    match side {
        Outcome::Yes => {
            position.yes_amount = position
                .yes_amount
                .checked_add(quote.token_amount)
                .ok_or(IbpmError::MathOverflow)?;
            position.yes_cost = position
                .yes_cost
                .checked_add(gies_amount)
                .ok_or(IbpmError::MathOverflow)?;
        }
        Outcome::No => {
            position.no_amount = position
                .no_amount
                .checked_add(quote.token_amount)
                .ok_or(IbpmError::MathOverflow)?;
            position.no_cost = position
                .no_cost
                .checked_add(gies_amount)
                .ok_or(IbpmError::MathOverflow)?;
        }
    }
    emit!(TradeExecuted {
        market: market.key(), wallet: ctx.accounts.trader.key(), side: 0, outcome,
        gies_amount: gies_amount, token_amount: quote.token_amount,
        fee: quote.fee, yes_pool: market.yes_pool, no_pool: market.no_pool,
    });
    Ok(())
}

pub fn sell(ctx: Context<Trade>, outcome: u8, token_amount: u64, min_gies_out: u64) -> Result<()> {
    require_open(&ctx.accounts.market)?;
    require_participant(&ctx.accounts.trader_user)?;
    let side = outcome_from_u8(outcome)?;
    let held = match side {
        Outcome::Yes => ctx.accounts.position.yes_amount,
        Outcome::No => ctx.accounts.position.no_amount,
    };
    require!(held >= token_amount, IbpmError::InsufficientTokens);

    let fee_bps = math::dynamic_fee_bps(
        ctx.accounts.market.yes_pool,
        ctx.accounts.market.no_pool,
        ctx.accounts.market.fee_base_bps,
        ctx.accounts.market.fee_max_bps,
    )?;
    let quote = math::quote_sell(
        ctx.accounts.market.yes_pool,
        ctx.accounts.market.no_pool,
        side,
        token_amount,
        fee_bps,
    )?;
    require!(quote.gies_amount >= min_gies_out, IbpmError::SlippageExceeded);
    math::check_safeguards(
        &quote,
        ctx.accounts.market.yes_pool,
        ctx.accounts.market.no_pool,
        quote.gies_amount,
        market_safeguards(&ctx.accounts.market),
    )?;

    let market_id = ctx.accounts.market.market_id.to_le_bytes();
    let bump = ctx.accounts.market.bump;
    let seeds: &[&[u8]] = &[MARKET_SEED, market_id.as_ref(), &[bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.trader_gies.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            &[seeds],
        ),
        quote.gies_amount,
    )?;

    let market = &mut ctx.accounts.market;
    // Reinvest fee collateral as complete sets so LP reserves earn the fee.
    market.yes_pool = quote.new_yes_pool.checked_add(quote.fee).ok_or(IbpmError::MathOverflow)?;
    market.no_pool = quote.new_no_pool.checked_add(quote.fee).ok_or(IbpmError::MathOverflow)?;
    market.vault_collateral = market
        .vault_collateral
        .checked_sub(quote.gies_amount)
        .ok_or(IbpmError::MathOverflow)?;
    market.cumulative_fees = market
        .cumulative_fees
        .checked_add(quote.fee)
        .ok_or(IbpmError::MathOverflow)?;
    apply_supply_delta(market, quote.supply_delta.checked_add(quote.fee as i128).ok_or(IbpmError::MathOverflow)?)?;

    let position = &mut ctx.accounts.position;
    match side {
        Outcome::Yes => {
            let cost = if token_amount == position.yes_amount {
                position.yes_cost
            } else {
                (position.yes_cost as u128 * token_amount as u128 / held as u128) as u64
            };
            position.yes_amount -= token_amount;
            position.yes_cost -= cost;
            position.realized_pnl = position
                .realized_pnl
                .saturating_add(quote.gies_amount as i64)
                .saturating_sub(cost as i64);
        }
        Outcome::No => {
            let cost = if token_amount == position.no_amount {
                position.no_cost
            } else {
                (position.no_cost as u128 * token_amount as u128 / held as u128) as u64
            };
            position.no_amount -= token_amount;
            position.no_cost -= cost;
            position.realized_pnl = position
                .realized_pnl
                .saturating_add(quote.gies_amount as i64)
                .saturating_sub(cost as i64);
        }
    }
    emit!(TradeExecuted {
        market: market.key(), wallet: ctx.accounts.trader.key(), side: 1, outcome,
        gies_amount: quote.gies_amount, token_amount: token_amount,
        fee: quote.fee, yes_pool: market.yes_pool, no_pool: market.no_pool,
    });
    Ok(())
}

pub fn add_liquidity(ctx: Context<ModifyLiquidity>, gies_amount: u64) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    require_open(&ctx.accounts.market)?;
    require_active(&ctx.accounts.trader_user)?;
    require!(ctx.accounts.trader_user.kind == KIND_MAKER, IbpmError::NotMaker);
    let (yes_add, no_add, yes_back, no_back, shares) = math::quote_lp_add(
        ctx.accounts.market.yes_pool,
        ctx.accounts.market.no_pool,
        ctx.accounts.market.lp_shares,
        gies_amount,
    )?;
    require!(
        ctx.accounts.desk.amount >= gies_amount,
        IbpmError::InsufficientGies
    );

    let wallet = ctx.accounts.trader.key();
    let bump = ctx.accounts.trader_user.bump;
    let seeds: &[&[u8]] = &[USER_SEED, wallet.as_ref(), &[bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.desk.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.trader_user.to_account_info(),
            },
            &[seeds],
        ),
        gies_amount,
    )?;

    let market = &mut ctx.accounts.market;
    market.yes_pool = market
        .yes_pool
        .checked_add(yes_add)
        .ok_or(IbpmError::MathOverflow)?;
    market.no_pool = market
        .no_pool
        .checked_add(no_add)
        .ok_or(IbpmError::MathOverflow)?;
    market.vault_collateral = market
        .vault_collateral
        .checked_add(gies_amount)
        .ok_or(IbpmError::MathOverflow)?;
    market.lp_shares = market
        .lp_shares
        .checked_add(shares)
        .ok_or(IbpmError::MathOverflow)?;
    apply_supply_delta(market, gies_amount as i128)?;

    let lp = &mut ctx.accounts.lp;
    if lp.owner == Pubkey::default() {
        lp.market = market.key();
        lp.owner = ctx.accounts.trader.key();
        lp.bump = ctx.bumps.lp;
    }
    let was_zero = lp.shares == 0;
    lp.shares = lp.shares.checked_add(shares).ok_or(IbpmError::MathOverflow)?;
    lp.gies_provided = lp
        .gies_provided
        .checked_add(gies_amount)
        .ok_or(IbpmError::MathOverflow)?;
    if was_zero {
        ctx.accounts.trader_user.open_lp_count = ctx
            .accounts
            .trader_user
            .open_lp_count
            .checked_add(1)
            .ok_or(IbpmError::MathOverflow)?;
    }

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.market = market.key();
        position.owner = ctx.accounts.trader.key();
        position.bump = ctx.bumps.position;
    }
    position.yes_amount = position
        .yes_amount
        .checked_add(yes_back)
        .ok_or(IbpmError::MathOverflow)?;
    position.no_amount = position
        .no_amount
        .checked_add(no_back)
        .ok_or(IbpmError::MathOverflow)?;
    Ok(())
}

pub fn remove_liquidity(ctx: Context<ModifyLiquidity>, shares: u64) -> Result<()> {
    require!(ctx.accounts.trader_user.kind == KIND_MAKER, IbpmError::NotMaker);
    require_participant(&ctx.accounts.trader_user)?;
    require!(ctx.accounts.lp.shares >= shares, IbpmError::InsufficientTokens);
    let (yes_out, no_out, matched, yes_left, no_left) = math::quote_lp_remove(
        ctx.accounts.market.yes_pool,
        ctx.accounts.market.no_pool,
        ctx.accounts.market.lp_shares,
        shares,
    )?;

    if matched > 0 {
        let market_id = ctx.accounts.market.market_id.to_le_bytes();
        let bump = ctx.accounts.market.bump;
        let seeds: &[&[u8]] = &[MARKET_SEED, market_id.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.desk.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                &[seeds],
            ),
            matched,
        )?;
    }

    let market = &mut ctx.accounts.market;
    market.yes_pool = market
        .yes_pool
        .checked_sub(yes_out)
        .ok_or(IbpmError::MathOverflow)?;
    market.no_pool = market
        .no_pool
        .checked_sub(no_out)
        .ok_or(IbpmError::MathOverflow)?;
    market.vault_collateral = market
        .vault_collateral
        .checked_sub(matched)
        .ok_or(IbpmError::MathOverflow)?;
    market.lp_shares = market
        .lp_shares
        .checked_sub(shares)
        .ok_or(IbpmError::MathOverflow)?;
    apply_supply_delta(market, -(matched as i128))?;

    let lp = &mut ctx.accounts.lp;
    lp.shares -= shares;
    if lp.shares == 0 {
        ctx.accounts.trader_user.open_lp_count = ctx
            .accounts
            .trader_user
            .open_lp_count
            .saturating_sub(1);
    }

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.market = market.key();
        position.owner = ctx.accounts.trader.key();
        position.bump = ctx.bumps.position;
    }
    position.yes_amount = position
        .yes_amount
        .checked_add(yes_left)
        .ok_or(IbpmError::MathOverflow)?;
    position.no_amount = position
        .no_amount
        .checked_add(no_left)
        .ok_or(IbpmError::MathOverflow)?;
    Ok(())
}

pub fn withdraw_protocol_liquidity(ctx: Context<ProtocolLiquidity>, shares: u64) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require!(ctx.accounts.lp.owner == ctx.accounts.config.key(), IbpmError::Unauthorized);
    require!(ctx.accounts.lp.shares >= shares, IbpmError::InsufficientTokens);
    let (yes_out, no_out, matched, yes_left, no_left) = math::quote_lp_remove(
        ctx.accounts.market.yes_pool,
        ctx.accounts.market.no_pool,
        ctx.accounts.market.lp_shares,
        shares,
    )?;

    if matched > 0 {
        let market_id = ctx.accounts.market.market_id.to_le_bytes();
        let bump = ctx.accounts.market.bump;
        let seeds: &[&[u8]] = &[MARKET_SEED, market_id.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                &[seeds],
            ),
            matched,
        )?;
    }

    let config_key = ctx.accounts.config.key();
    let market = &mut ctx.accounts.market;
    market.yes_pool = market
        .yes_pool
        .checked_sub(yes_out)
        .ok_or(IbpmError::MathOverflow)?;
    market.no_pool = market
        .no_pool
        .checked_sub(no_out)
        .ok_or(IbpmError::MathOverflow)?;
    market.vault_collateral = market
        .vault_collateral
        .checked_sub(matched)
        .ok_or(IbpmError::MathOverflow)?;
    market.lp_shares = market
        .lp_shares
        .checked_sub(shares)
        .ok_or(IbpmError::MathOverflow)?;
    apply_supply_delta(market, -(matched as i128))?;
    ctx.accounts.lp.shares -= shares;

    if yes_left > 0 || no_left > 0 {
        let position = &mut ctx.accounts.position;
        if position.owner == Pubkey::default() {
            position.market = market.key();
            position.owner = config_key;
            position.bump = ctx.bumps.position;
        }
        position.yes_amount = position
            .yes_amount
            .checked_add(yes_left)
            .ok_or(IbpmError::MathOverflow)?;
        position.no_amount = position
            .no_amount
            .checked_add(no_left)
            .ok_or(IbpmError::MathOverflow)?;
    }
    Ok(())
}

pub fn redeem(ctx: Context<Redeem>, outcome: u8) -> Result<()> {
    require!(
        ctx.accounts.market.status == STATUS_RESOLVED,
        IbpmError::MarketNotResolved
    );
    let side = outcome_from_u8(outcome)?;
    let (amount, cost) = match side {
        Outcome::Yes => (ctx.accounts.position.yes_amount, ctx.accounts.position.yes_cost),
        Outcome::No => (ctx.accounts.position.no_amount, ctx.accounts.position.no_cost),
    };
    require!(amount > 0, IbpmError::InsufficientTokens);
    settle_redeem(
        &mut ctx.accounts.market,
        &mut ctx.accounts.position,
        &ctx.accounts.vault,
        &ctx.accounts.trader_gies.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        side,
        amount,
        cost,
    )
}

pub fn redeem_protocol(ctx: Context<RedeemProtocol>, outcome: u8) -> Result<()> {
    auth_routine(
        ctx.accounts.payer.key(),
        &ctx.accounts.config,
        ctx.remaining_accounts,
    )?;
    require!(
        ctx.accounts.position.owner == ctx.accounts.config.key(),
        IbpmError::Unauthorized
    );
    require!(
        ctx.accounts.market.status == STATUS_RESOLVED,
        IbpmError::MarketNotResolved
    );
    let side = outcome_from_u8(outcome)?;
    let (amount, cost) = match side {
        Outcome::Yes => (ctx.accounts.position.yes_amount, ctx.accounts.position.yes_cost),
        Outcome::No => (ctx.accounts.position.no_amount, ctx.accounts.position.no_cost),
    };
    require!(amount > 0, IbpmError::InsufficientTokens);
    settle_redeem(
        &mut ctx.accounts.market,
        &mut ctx.accounts.position,
        &ctx.accounts.vault,
        &ctx.accounts.treasury.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        side,
        amount,
        cost,
    )
}

fn settle_redeem<'info>(
    market: &mut Account<'info, Market>,
    position: &mut Account<'info, Position>,
    vault: &Account<'info, TokenAccount>,
    destination: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    side: Outcome,
    amount: u64,
    cost: u64,
) -> Result<()> {
    let winning = market.outcome
        == match side {
            Outcome::Yes => OUTCOME_YES,
            Outcome::No => OUTCOME_NO,
        };
    let payout = if winning { amount } else { 0 };

    if payout > 0 {
        require!(market.vault_collateral >= payout, IbpmError::InsufficientGies);
        let market_id = market.market_id.to_le_bytes();
        let bump = market.bump;
        let seeds: &[&[u8]] = &[MARKET_SEED, market_id.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                token_program.clone(),
                Transfer {
                    from: vault.to_account_info(),
                    to: destination.clone(),
                    authority: market.to_account_info(),
                },
                &[seeds],
            ),
            payout,
        )?;
        market.vault_collateral -= payout;
    }

    match side {
        Outcome::Yes => {
            market.total_yes_supply = market
                .total_yes_supply
                .checked_sub(amount)
                .ok_or(IbpmError::MathOverflow)?;
            position.yes_amount = 0;
            position.yes_cost = 0;
        }
        Outcome::No => {
            market.total_no_supply = market
                .total_no_supply
                .checked_sub(amount)
                .ok_or(IbpmError::MathOverflow)?;
            position.no_amount = 0;
            position.no_cost = 0;
        }
    }
    position.realized_pnl = position
        .realized_pnl
        .saturating_add(payout as i64)
        .saturating_sub(cost as i64);
    Ok(())
}

#[derive(Accounts)]
#[instruction(members: [Pubkey; MAX_COMMITTEE], member_count: u8, routine_threshold: u8, resolve_threshold: u8)]
pub struct Initialize<'info> {
    #[account(seeds = [crate::ID.as_ref()], bump, seeds::program = anchor_lang::solana_program::bpf_loader_upgradeable::ID)]
    pub program_data: Account<'info, ProgramData>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = payer,
        seeds = [MINT_SEED],
        bump,
        mint::decimals = GIES_DECIMALS,
        mint::authority = config
    )]
    pub gies_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        seeds = [TREASURY_SEED],
        bump,
        token::mint = gies_mint,
        token::authority = config
    )]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitteeConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Box<Account<'info, Config>>,
}

#[derive(Accounts)]
pub struct Enroll<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: wallet being added to the allowlist
    pub wallet: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + User::INIT_SPACE,
        seeds = [USER_SEED, wallet.key().as_ref()],
        bump
    )]
    pub user: Account<'info, User>,
    #[account(address = config.gies_mint)]
    pub gies_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        seeds = [DESK_SEED, wallet.key().as_ref()],
        bump,
        token::mint = gies_mint,
        token::authority = user
    )]
    pub desk: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateParticipant<'info> {
    pub payer: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [USER_SEED, user.wallet.as_ref()],
        bump = user.bump
    )]
    pub user: Account<'info, User>,
    #[account(
        seeds = [DESK_SEED, user.wallet.as_ref()],
        bump,
        token::mint = gies_mint,
        token::authority = user
    )]
    pub desk: Account<'info, TokenAccount>,
    #[account(address = config.gies_mint)]
    pub gies_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct GrantGies<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = gies_mint
    )]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: allowlisted wallet
    pub recipient: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [USER_SEED, recipient.key().as_ref()],
        bump = recipient_user.bump
    )]
    pub recipient_user: Account<'info, User>,
    #[account(mut)]
    pub gies_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = gies_mint,
        associated_token::authority = recipient
    )]
    pub recipient_gies: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TreasuryMint<'info> {
    pub payer: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = gies_mint
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub gies_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = config.treasury_bump
    )]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MakerCapital<'info> {
    pub payer: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = gies_mint
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [USER_SEED, user.wallet.as_ref()],
        bump = user.bump
    )]
    pub user: Account<'info, User>,
    #[account(mut)]
    pub gies_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [DESK_SEED, user.wallet.as_ref()],
        bump,
        token::mint = gies_mint,
        token::authority = user
    )]
    pub desk: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = config.treasury_bump
    )]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = gies_mint
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, &market_id.to_le_bytes()],
        bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = gies_mint,
        token::authority = market
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        space = 8 + LpPosition::INIT_SPACE,
        seeds = [LP_SEED, market.key().as_ref(), config.key().as_ref()],
        bump
    )]
    pub protocol_lp: Box<Account<'info, LpPosition>>,
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = config.treasury_bump
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub gies_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MarketAdmin<'info> {
    pub payer: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ProtocolLiquidity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [LP_SEED, market.key().as_ref(), config.key().as_ref()],
        bump = lp.bump
    )]
    pub lp: Box<Account<'info, LpPosition>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Position::INIT_SPACE,
        seeds = [POS_SEED, market.key().as_ref(), config.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = config.treasury_bump
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = gies_mint
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [USER_SEED, trader.key().as_ref()],
        bump = trader_user.bump
    )]
    pub trader_user: Box<Account<'info, User>>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = trader,
        space = 8 + Position::INIT_SPACE,
        seeds = [POS_SEED, market.key().as_ref(), trader.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,
    #[account(
        mut,
        associated_token::mint = gies_mint,
        associated_token::authority = trader
    )]
    pub trader_gies: Box<Account<'info, TokenAccount>>,
    pub gies_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ModifyLiquidity<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = gies_mint
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [USER_SEED, trader.key().as_ref()],
        bump = trader_user.bump
    )]
    pub trader_user: Box<Account<'info, User>>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = trader,
        space = 8 + LpPosition::INIT_SPACE,
        seeds = [LP_SEED, market.key().as_ref(), trader.key().as_ref()],
        bump
    )]
    pub lp: Box<Account<'info, LpPosition>>,
    #[account(
        init_if_needed,
        payer = trader,
        space = 8 + Position::INIT_SPACE,
        seeds = [POS_SEED, market.key().as_ref(), trader.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,
    #[account(
        mut,
        seeds = [DESK_SEED, trader.key().as_ref()],
        bump,
        token::mint = gies_mint,
        token::authority = trader_user
    )]
    pub desk: Box<Account<'info, TokenAccount>>,
    pub gies_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [POS_SEED, market.key().as_ref(), trader.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        associated_token::mint = gies_mint,
        associated_token::authority = trader
    )]
    pub trader_gies: Account<'info, TokenAccount>,
    pub gies_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RedeemProtocol<'info> {
    pub payer: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump = market.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [POS_SEED, market.key().as_ref(), config.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = config.treasury_bump
    )]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

fn validate_market_params(base: u16, max: u16, impact: u16, depth: u64, size: u16) -> Result<()> {
    require!(base <= max && max <= 1_000 && impact > 0 && impact <= 10_000 && depth > 0 && size > 0 && size <= 10_000, IbpmError::InvalidAmount);
    Ok(())
}

pub fn set_market_params(ctx: Context<MarketAdmin>, fee_base_bps: u16, fee_max_bps: u16, max_price_impact_bps: u16, min_pool_depth: u64, max_trade_size_bps: u16) -> Result<()> {
    auth_routine(ctx.accounts.payer.key(), &ctx.accounts.config, ctx.remaining_accounts)?;
    require!(ctx.accounts.market.status != STATUS_RESOLVED, IbpmError::AlreadyResolved);
    validate_market_params(fee_base_bps, fee_max_bps, max_price_impact_bps, min_pool_depth, max_trade_size_bps)?;
    let market = &mut ctx.accounts.market;
    market.fee_base_bps = fee_base_bps;
    market.fee_max_bps = fee_max_bps;
    market.max_price_impact_bps = max_price_impact_bps;
    market.min_pool_depth = min_pool_depth;
    market.max_trade_size_bps = max_trade_size_bps;
    Ok(())
}

pub fn pay_reward(ctx: Context<PayReward>, claim_id: u64, attributed_fees: u64, evidence_hash: [u8; 32]) -> Result<()> {
    auth_resolve(ctx.accounts.payer.key(), &ctx.accounts.config, ctx.remaining_accounts)?;
    require_not_paused(&ctx.accounts.config)?;
    require_active(&ctx.accounts.recipient_user)?;
    require!(ctx.accounts.recipient_user.kind == KIND_MAKER, IbpmError::NotMaker);
    require!(attributed_fees > 0 && evidence_hash != [0; 32], IbpmError::InvalidAmount);
    let reward = (attributed_fees as u128)
        .checked_mul(ctx.accounts.config.fee_match_bps as u128).ok_or(IbpmError::MathOverflow)? / 10_000;
    let amount = u64::try_from(reward).map_err(|_| IbpmError::MathOverflow)?;
    require!(amount > 0, IbpmError::InvalidAmount);
    require!(amount <= ctx.accounts.config.reward_budget, IbpmError::RewardBudgetExceeded);
    ctx.accounts.config.reward_budget -= amount;
    let claim = &mut ctx.accounts.claim;
    claim.claim_id = claim_id;
    claim.recipient = ctx.accounts.recipient.key();
    claim.attributed_fees = attributed_fees;
    claim.amount = amount;
    claim.evidence_hash = evidence_hash;
    mint_with_config(ctx.accounts.token_program.to_account_info(), ctx.accounts.gies_mint.to_account_info(), ctx.accounts.recipient_gies.to_account_info(), ctx.accounts.config.to_account_info(), ctx.accounts.config.bump, amount)
}

#[derive(Accounts)]
#[instruction(claim_id: u64)]
pub struct PayReward<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = gies_mint)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: recipient identity bound to the enrollment PDA and ATA below.
    pub recipient: UncheckedAccount<'info>,
    #[account(seeds = [USER_SEED, recipient.key().as_ref()], bump = recipient_user.bump)]
    pub recipient_user: Account<'info, User>,
    #[account(mut)]
    pub gies_mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = payer, associated_token::mint = gies_mint, associated_token::authority = recipient)]
    pub recipient_gies: Account<'info, TokenAccount>,
    #[account(init, payer = payer, space = 8 + RewardClaim::INIT_SPACE, seeds = [REWARD_SEED, &claim_id.to_le_bytes()], bump)]
    pub claim: Account<'info, RewardClaim>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Upgrade authority must first be transferred to the config PDA by the deployer.
/// The buffer authority must also be config; the loader verifies its contents.
pub fn upgrade_program(ctx: Context<UpgradeProgram>) -> Result<()> {
    auth_resolve(ctx.accounts.payer.key(), &ctx.accounts.config, ctx.remaining_accounts)?;
    require!(ctx.accounts.program_data.upgrade_authority_address == Some(ctx.accounts.config.key()), IbpmError::Unauthorized);
    let instruction = anchor_lang::solana_program::bpf_loader_upgradeable::upgrade(
        &crate::ID, &ctx.accounts.buffer.key(), &ctx.accounts.config.key(), &ctx.accounts.payer.key(),
    );
    anchor_lang::solana_program::program::invoke_signed(&instruction, &[
        ctx.accounts.program_data.to_account_info(), ctx.accounts.program.to_account_info(),
        ctx.accounts.buffer.to_account_info(), ctx.accounts.payer.to_account_info(),
        ctx.accounts.rent.to_account_info(), ctx.accounts.clock.to_account_info(),
        ctx.accounts.config.to_account_info(), ctx.accounts.loader.to_account_info(),
    ], &[&[CONFIG_SEED, &[ctx.accounts.config.bump]]])?;
    Ok(())
}

#[derive(Accounts)]
pub struct UpgradeProgram<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: fixed executable program ID; upgradeable loader validates it.
    #[account(mut, address = crate::ID)]
    pub program: UncheckedAccount<'info>,
    #[account(mut, seeds = [crate::ID.as_ref()], bump, seeds::program = anchor_lang::solana_program::bpf_loader_upgradeable::ID)]
    pub program_data: Account<'info, ProgramData>,
    /// CHECK: loader validates buffer ownership, state, authority and bytecode.
    #[account(mut, owner = anchor_lang::solana_program::bpf_loader_upgradeable::ID)]
    pub buffer: UncheckedAccount<'info>,
    /// CHECK: loader address is fixed.
    #[account(address = anchor_lang::solana_program::bpf_loader_upgradeable::ID)]
    pub loader: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub clock: Sysvar<'info, Clock>,
}

#[event]
pub struct TradeExecuted {
    pub market: Pubkey,
    pub wallet: Pubkey,
    /// 0=buy, 1=sell. Outcome: 1=YES, 2=NO.
    pub side: u8,
    pub outcome: u8,
    pub gies_amount: u64,
    pub token_amount: u64,
    pub fee: u64,
    pub yes_pool: u64,
    pub no_pool: u64,
}
