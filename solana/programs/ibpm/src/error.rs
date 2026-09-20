use anchor_lang::prelude::*;

#[error_code]
pub enum IbpmError {
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Pool is empty")]
    EmptyPool,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Price impact exceeds the market limit")]
    PriceImpactTooHigh,
    #[msg("Trade would drain the pool below minimum depth")]
    PoolTooShallow,
    #[msg("Trade size exceeds the market limit")]
    TradeTooLarge,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Program is paused")]
    Paused,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Market is not resolved")]
    MarketNotResolved,
    #[msg("Market already resolved")]
    AlreadyResolved,
    #[msg("Insufficient tokens")]
    InsufficientTokens,
    #[msg("Insufficient GIES")]
    InsufficientGies,
    #[msg("Open LP positions must be removed first")]
    OpenLpPositions,
    #[msg("Desk must be empty")]
    DeskNotEmpty,
    #[msg("Market id mismatch")]
    MarketIdMismatch,
    #[msg("Wrong outcome")]
    InvalidOutcome,
    #[msg("Already registered")]
    AlreadyRegistered,
}
