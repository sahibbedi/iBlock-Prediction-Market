use crate::constants::*;
use crate::error::IbpmError;
use crate::state::*;
use crate::math::{self, Outcome, Safeguards};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

pub mod helpers;
use helpers::*;

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.gies_mint = ctx.accounts.gies_mint.key();
    config.next_market_id = 0;
    config.paused = false;
    config.starter_amount = STARTER_AMOUNT;
    config.desk_amount = DESK_AMOUNT;
    config.bump = ctx.bumps.config;
    config.mint_bump = ctx.bumps.gies_mint;
    Ok(())
}

pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

pub fn register_user(ctx: Context<RegisterUser>) -> Result<()> {
    let user = &mut ctx.accounts.user;
    user.wallet = ctx.accounts.wallet.key();
    user.role = if ctx.accounts.wallet.key() == ctx.accounts.config.admin {
        ROLE_ADMIN
    } else {
        ROLE_STUDENT
    };
    user.open_lp_count = 0;
    user.bump = ctx.bumps.user;
    Ok(())
}

pub fn grant_gies(ctx: Context<GrantGies>, amount: u64) -> Result<()> {
    require!(amount > 0, IbpmError::InvalidAmount);
    let bump = ctx.accounts.config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.gies_mint.to_account_info(),
                to: ctx.accounts.recipient_gies.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    Ok(())
}

pub fn set_role(ctx: Context<SetRole>, role: u8) -> Result<()> {
    require!(
        role == ROLE_STUDENT || role == ROLE_MAKER || role == ROLE_TEACHER || role == ROLE_ADMIN,
        IbpmError::InvalidAmount
    );
    let actor = ctx.accounts.actor_user.role;
    if role == ROLE_ADMIN || role == ROLE_TEACHER {
        require!(is_admin(actor), IbpmError::Unauthorized);
    } else {
        require!(is_teacher(actor), IbpmError::Unauthorized);
    }
    if role == ROLE_STUDENT {
        require!(ctx.accounts.target.open_lp_count == 0, IbpmError::OpenLpPositions);
        require!(ctx.accounts.desk.amount == 0, IbpmError::DeskNotEmpty);
    }
    ctx.accounts.target.role = role;
    Ok(())
}

pub fn fund_desk(ctx: Context<FundDesk>) -> Result<()> {
    require!(is_teacher(ctx.accounts.actor_user.role), IbpmError::Unauthorized);
    require!(ctx.accounts.target.role != ROLE_ADMIN, IbpmError::Unauthorized);
    require!(ctx.accounts.desk.amount == 0, IbpmError::DeskNotEmpty);
    let amount = ctx.accounts.config.desk_amount;
    let bump = ctx.accounts.config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.gies_mint.to_account_info(),
                to: ctx.accounts.desk.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    ctx.accounts.target.role = ROLE_MAKER;
    Ok(())
}

pub fn settle_desk(ctx: Context<SettleDesk>) -> Result<()> {
    let actor = ctx.accounts.actor_user.role;
    let is_self = ctx.accounts.actor.key() == ctx.accounts.target.wallet;
    require!(is_teacher(actor) || is_self, IbpmError::Unauthorized);
    require!(ctx.accounts.target.open_lp_count == 0, IbpmError::OpenLpPositions);
    let amount = ctx.accounts.desk.amount;
    if amount > 0 {
        let wallet = ctx.accounts.target.wallet;
        let bump = ctx.accounts.target.bump;
        let seeds: &[&[u8]] = &[USER_SEED, wallet.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.desk.to_account_info(),
                    to: ctx.accounts.personal_gies.to_account_info(),
                    authority: ctx.accounts.target.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
    }
    ctx.accounts.target.role = ROLE_STUDENT;
    Ok(())
}

pub fn create_market(
    ctx: Context<CreateMarket>,
    market_id: u64,
    initial_liquidity: u64,
    max_price_impact_bps: Option<u16>,
    min_pool_depth: Option<u64>,
    max_trade_size_bps: Option<u16>,
) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    require!(is_teacher(ctx.accounts.creator_user.role), IbpmError::Unauthorized);
    require!(market_id == ctx.accounts.config.next_market_id, IbpmError::MarketIdMismatch);
    require!(initial_liquidity > 0, IbpmError::InvalidAmount);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.creator_gies.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        initial_liquidity,
    )?;

    let (fee_base, fee_max, def_impact, def_depth, def_trade) = Market::default_params();
    let market = &mut ctx.accounts.market;
    market.market_id = market_id;
    market.creator = ctx.accounts.creator.key();
    market.resolver = ctx.accounts.creator.key();
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
    market.bump = ctx.bumps.market;
    market.vault_bump = ctx.bumps.vault;

    let lp = &mut ctx.accounts.creator_lp;
    lp.market = market.key();
    lp.owner = ctx.accounts.creator.key();
    lp.shares = initial_liquidity;
    lp.gies_provided = initial_liquidity;
    lp.bump = ctx.bumps.creator_lp;

    ctx.accounts.creator_user.open_lp_count = ctx
        .accounts
        .creator_user
        .open_lp_count
        .checked_add(1)
        .ok_or(IbpmError::MathOverflow)?;
    ctx.accounts.config.next_market_id = market_id
        .checked_add(1)
        .ok_or(IbpmError::MathOverflow)?;
    Ok(())
}

pub fn close_market(ctx: Context<ResolveMarket>) -> Result<()> {
    require!(
        ctx.accounts.resolver.key() == ctx.accounts.market.resolver
            || is_admin(ctx.accounts.resolver_user.role),
        IbpmError::Unauthorized
    );
    require!(ctx.accounts.market.status == STATUS_OPEN, IbpmError::MarketNotOpen);
    ctx.accounts.market.status = STATUS_CLOSED;
    Ok(())
}

pub fn resolve_market(ctx: Context<ResolveMarket>, outcome: u8) -> Result<()> {
    require!(
        ctx.accounts.resolver.key() == ctx.accounts.market.resolver
            || is_admin(ctx.accounts.resolver_user.role),
        IbpmError::Unauthorized
    );
    require!(
        ctx.accounts.market.status != STATUS_RESOLVED,
        IbpmError::AlreadyResolved
    );
    require!(outcome == OUTCOME_YES || outcome == OUTCOME_NO, IbpmError::InvalidOutcome);
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
        market.total_yes_supply = market.total_yes_supply.checked_add(d).ok_or(IbpmError::MathOverflow)?;
        market.total_no_supply = market.total_no_supply.checked_add(d).ok_or(IbpmError::MathOverflow)?;
    } else {
        let d = (-delta) as u64;
        market.total_yes_supply = market.total_yes_supply.checked_sub(d).ok_or(IbpmError::MathOverflow)?;
        market.total_no_supply = market.total_no_supply.checked_sub(d).ok_or(IbpmError::MathOverflow)?;
    }
    Ok(())
}

pub fn buy(ctx: Context<Trade>, outcome: u8, gies_amount: u64) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    require_open(&ctx.accounts.market)?;
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
    market.yes_pool = quote.new_yes_pool;
    market.no_pool = quote.new_no_pool;
    market.vault_collateral = market
        .vault_collateral
        .checked_add(gies_amount)
        .ok_or(IbpmError::MathOverflow)?;
    market.cumulative_fees = market
        .cumulative_fees
        .checked_add(quote.fee)
        .ok_or(IbpmError::MathOverflow)?;
    apply_supply_delta(market, quote.supply_delta)?;

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.market = market.key();
        position.owner = ctx.accounts.trader.key();
        position.bump = ctx.bumps.position;
    }
    match side {
        Outcome::Yes => {
            position.yes_amount = position.yes_amount.checked_add(quote.token_amount).ok_or(IbpmError::MathOverflow)?;
            position.yes_cost = position.yes_cost.checked_add(gies_amount).ok_or(IbpmError::MathOverflow)?;
        }
        Outcome::No => {
            position.no_amount = position.no_amount.checked_add(quote.token_amount).ok_or(IbpmError::MathOverflow)?;
            position.no_cost = position.no_cost.checked_add(gies_amount).ok_or(IbpmError::MathOverflow)?;
        }
    }
    Ok(())
}

pub fn sell(ctx: Context<Trade>, outcome: u8, token_amount: u64) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    require_open(&ctx.accounts.market)?;
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
    market.yes_pool = quote.new_yes_pool;
    market.no_pool = quote.new_no_pool;
    market.vault_collateral = market
        .vault_collateral
        .checked_sub(quote.gies_amount)
        .ok_or(IbpmError::MathOverflow)?;
    market.cumulative_fees = market
        .cumulative_fees
        .checked_add(quote.fee)
        .ok_or(IbpmError::MathOverflow)?;
    apply_supply_delta(market, quote.supply_delta)?;

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
    Ok(())
}

fn lp_source_is_desk(role: u8) -> bool {
    role == ROLE_MAKER
}

pub fn add_liquidity(ctx: Context<ModifyLiquidity>, gies_amount: u64) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    require_open(&ctx.accounts.market)?;
    require!(can_lp(ctx.accounts.trader_user.role), IbpmError::Unauthorized);
    let (yes_add, no_add, yes_back, no_back, shares) = math::quote_lp_add(
        ctx.accounts.market.yes_pool,
        ctx.accounts.market.no_pool,
        ctx.accounts.market.lp_shares,
        gies_amount,
    )?;

    let from_desk = lp_source_is_desk(ctx.accounts.trader_user.role);
    if from_desk {
        require!(ctx.accounts.desk.amount >= gies_amount, IbpmError::InsufficientGies);
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
    } else {
        require!(ctx.accounts.trader_gies.amount >= gies_amount, IbpmError::InsufficientGies);
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
    }

    let market = &mut ctx.accounts.market;
    market.yes_pool = market.yes_pool.checked_add(yes_add).ok_or(IbpmError::MathOverflow)?;
    market.no_pool = market.no_pool.checked_add(no_add).ok_or(IbpmError::MathOverflow)?;
    market.vault_collateral = market.vault_collateral.checked_add(gies_amount).ok_or(IbpmError::MathOverflow)?;
    market.lp_shares = market.lp_shares.checked_add(shares).ok_or(IbpmError::MathOverflow)?;
    apply_supply_delta(market, gies_amount as i128)?;

    let lp = &mut ctx.accounts.lp;
    if lp.owner == Pubkey::default() {
        lp.market = market.key();
        lp.owner = ctx.accounts.trader.key();
        lp.bump = ctx.bumps.lp;
    }
    let was_zero = lp.shares == 0;
    lp.shares = lp.shares.checked_add(shares).ok_or(IbpmError::MathOverflow)?;
    lp.gies_provided = lp.gies_provided.checked_add(gies_amount).ok_or(IbpmError::MathOverflow)?;
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
    position.yes_amount = position.yes_amount.checked_add(yes_back).ok_or(IbpmError::MathOverflow)?;
    position.no_amount = position.no_amount.checked_add(no_back).ok_or(IbpmError::MathOverflow)?;
    Ok(())
}

pub fn remove_liquidity(ctx: Context<ModifyLiquidity>, shares: u64) -> Result<()> {
    require!(can_lp(ctx.accounts.trader_user.role), IbpmError::Unauthorized);
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
        let to = if lp_source_is_desk(ctx.accounts.trader_user.role) {
            ctx.accounts.desk.to_account_info()
        } else {
            ctx.accounts.trader_gies.to_account_info()
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to,
                    authority: ctx.accounts.market.to_account_info(),
                },
                &[seeds],
            ),
            matched,
        )?;
    }

    let market = &mut ctx.accounts.market;
    market.yes_pool = market.yes_pool.checked_sub(yes_out).ok_or(IbpmError::MathOverflow)?;
    market.no_pool = market.no_pool.checked_sub(no_out).ok_or(IbpmError::MathOverflow)?;
    market.vault_collateral = market.vault_collateral.checked_sub(matched).ok_or(IbpmError::MathOverflow)?;
    market.lp_shares = market.lp_shares.checked_sub(shares).ok_or(IbpmError::MathOverflow)?;
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
    position.yes_amount = position.yes_amount.checked_add(yes_left).ok_or(IbpmError::MathOverflow)?;
    position.no_amount = position.no_amount.checked_add(no_left).ok_or(IbpmError::MathOverflow)?;
    Ok(())
}

pub fn redeem(ctx: Context<Redeem>, outcome: u8) -> Result<()> {
    require!(ctx.accounts.market.status == STATUS_RESOLVED, IbpmError::MarketNotResolved);
    let side = outcome_from_u8(outcome)?;
    let (amount, cost) = match side {
        Outcome::Yes => (ctx.accounts.position.yes_amount, ctx.accounts.position.yes_cost),
        Outcome::No => (ctx.accounts.position.no_amount, ctx.accounts.position.no_cost),
    };
    require!(amount > 0, IbpmError::InsufficientTokens);

    let winning = ctx.accounts.market.outcome
        == match side {
            Outcome::Yes => OUTCOME_YES,
            Outcome::No => OUTCOME_NO,
        };
    let payout = if winning { amount } else { 0 };

    if payout > 0 {
        require!(
            ctx.accounts.market.vault_collateral >= payout,
            IbpmError::InsufficientGies
        );
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
            payout,
        )?;
        ctx.accounts.market.vault_collateral -= payout;
    }

    match side {
        Outcome::Yes => {
            ctx.accounts.market.total_yes_supply = ctx
                .accounts
                .market
                .total_yes_supply
                .checked_sub(amount)
                .ok_or(IbpmError::MathOverflow)?;
            ctx.accounts.position.yes_amount = 0;
            ctx.accounts.position.yes_cost = 0;
        }
        Outcome::No => {
            ctx.accounts.market.total_no_supply = ctx
                .accounts
                .market
                .total_no_supply
                .checked_sub(amount)
                .ok_or(IbpmError::MathOverflow)?;
            ctx.accounts.position.no_amount = 0;
            ctx.accounts.position.no_cost = 0;
        }
    }
    ctx.accounts.position.realized_pnl = ctx
        .accounts
        .position
        .realized_pnl
        .saturating_add(payout as i64)
        .saturating_sub(cost as i64);
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = admin,
        seeds = [MINT_SEED],
        bump,
        mint::decimals = GIES_DECIMALS,
        mint::authority = config
    )]
    pub gies_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin
    )]
    pub config: Box<Account<'info, Config>>,
}

#[derive(Accounts)]
pub struct RegisterUser<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = wallet,
        space = 8 + User::INIT_SPACE,
        seeds = [USER_SEED, wallet.key().as_ref()],
        bump
    )]
    pub user: Account<'info, User>,
    #[account(address = config.gies_mint)]
    pub gies_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = wallet,
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
pub struct GrantGies<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin,
        has_one = gies_mint
    )]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: recipient wallet
    pub recipient: UncheckedAccount<'info>,
    #[account(
        seeds = [USER_SEED, recipient.key().as_ref()],
        bump = recipient_user.bump
    )]
    pub recipient_user: Account<'info, User>,
    #[account(mut)]
    pub gies_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = gies_mint,
        associated_token::authority = recipient
    )]
    pub recipient_gies: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetRole<'info> {
    pub actor: Signer<'info>,
    #[account(
        seeds = [USER_SEED, actor.key().as_ref()],
        bump = actor_user.bump
    )]
    pub actor_user: Account<'info, User>,
    #[account(
        mut,
        seeds = [USER_SEED, target.wallet.as_ref()],
        bump = target.bump
    )]
    pub target: Account<'info, User>,
    #[account(
        seeds = [DESK_SEED, target.wallet.as_ref()],
        bump,
        token::mint = gies_mint,
        token::authority = target
    )]
    pub desk: Account<'info, TokenAccount>,
    pub gies_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct FundDesk<'info> {
    pub actor: Signer<'info>,
    #[account(
        seeds = [USER_SEED, actor.key().as_ref()],
        bump = actor_user.bump
    )]
    pub actor_user: Account<'info, User>,
    #[account(
        mut,
        seeds = [USER_SEED, target.wallet.as_ref()],
        bump = target.bump
    )]
    pub target: Account<'info, User>,
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
        seeds = [DESK_SEED, target.wallet.as_ref()],
        bump,
        token::mint = gies_mint,
        token::authority = target
    )]
    pub desk: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleDesk<'info> {
    pub actor: Signer<'info>,
    #[account(
        seeds = [USER_SEED, actor.key().as_ref()],
        bump = actor_user.bump
    )]
    pub actor_user: Account<'info, User>,
    #[account(
        mut,
        seeds = [USER_SEED, target.wallet.as_ref()],
        bump = target.bump
    )]
    pub target: Account<'info, User>,
    #[account(
        mut,
        seeds = [DESK_SEED, target.wallet.as_ref()],
        bump,
        token::mint = gies_mint,
        token::authority = target
    )]
    pub desk: Account<'info, TokenAccount>,
    /// CHECK: personal wallet (target.wallet)
    #[account(address = target.wallet)]
    pub personal: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = gies_mint,
        associated_token::authority = personal
    )]
    pub personal_gies: Account<'info, TokenAccount>,
    pub gies_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_SEED, creator.key().as_ref()],
        bump = creator_user.bump
    )]
    pub creator_user: Account<'info, User>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = gies_mint
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, &market_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = gies_mint,
        token::authority = market
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = creator,
        space = 8 + LpPosition::INIT_SPACE,
        seeds = [LP_SEED, market.key().as_ref(), creator.key().as_ref()],
        bump
    )]
    pub creator_lp: Account<'info, LpPosition>,
    #[account(
        mut,
        associated_token::mint = gies_mint,
        associated_token::authority = creator
    )]
    pub creator_gies: Account<'info, TokenAccount>,
    pub gies_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    pub resolver: Signer<'info>,
    #[account(
        seeds = [USER_SEED, resolver.key().as_ref()],
        bump = resolver_user.bump
    )]
    pub resolver_user: Account<'info, User>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
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
