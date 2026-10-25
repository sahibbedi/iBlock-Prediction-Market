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
    #[msg("Maker capital must be clawed back first")]
    DeskNotEmpty,
    #[msg("Market id mismatch")]
    MarketIdMismatch,
    #[msg("Wrong outcome")]
    InvalidOutcome,
    #[msg("Already enrolled")]
    AlreadyEnrolled,
    #[msg("Not on the campus allowlist")]
    NotAllowlisted,
    #[msg("Participant is inactive")]
    Inactive,
    #[msg("Committee threshold not met")]
    ThresholdNotMet,
    #[msg("Not a committee member")]
    NotCommittee,
    #[msg("Invalid committee")]
    InvalidCommittee,
    #[msg("Maker appointment required")]
    NotMaker,
    #[msg("Reward exceeds remaining authorized emissions") ]
    RewardBudgetExceeded,
    #[msg("Output is below the signed minimum") ]
    SlippageExceeded,
    #[msg("Starting balance already granted")]
    StarterAlreadyClaimed,
}
