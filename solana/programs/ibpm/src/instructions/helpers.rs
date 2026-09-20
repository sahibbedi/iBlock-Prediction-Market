use crate::constants::*;
use crate::error::IbpmError;
use crate::state::Market;
use crate::math::Outcome;
use anchor_lang::prelude::*;

pub fn is_admin(role: u8) -> bool {
    role == ROLE_ADMIN
}

pub fn is_teacher(role: u8) -> bool {
    role == ROLE_TEACHER || role == ROLE_ADMIN
}

pub fn can_lp(role: u8) -> bool {
    role == ROLE_MAKER || role == ROLE_TEACHER || role == ROLE_ADMIN
}

pub fn outcome_from_u8(v: u8) -> Result<Outcome> {
    match v {
        OUTCOME_YES => Ok(Outcome::Yes),
        OUTCOME_NO => Ok(Outcome::No),
        _ => err!(IbpmError::InvalidOutcome),
    }
}

pub fn require_not_paused(config: &crate::state::Config) -> Result<()> {
    require!(!config.paused, IbpmError::Paused);
    Ok(())
}

pub fn require_open(market: &Market) -> Result<()> {
    require!(market.status == STATUS_OPEN, IbpmError::MarketNotOpen);
    Ok(())
}
