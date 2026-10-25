use crate::constants::*;
use crate::error::IbpmError;
use crate::state::{Config, Market, User};
use crate::math::Outcome;
use anchor_lang::prelude::*;

pub fn outcome_from_u8(v: u8) -> Result<Outcome> {
    match v {
        OUTCOME_YES => Ok(Outcome::Yes),
        OUTCOME_NO => Ok(Outcome::No),
        _ => err!(IbpmError::InvalidOutcome),
    }
}

pub fn require_not_paused(config: &Config) -> Result<()> {
    require!(!config.paused, IbpmError::Paused);
    Ok(())
}

pub fn require_open(market: &Market) -> Result<()> {
    require!(market.status == STATUS_OPEN, IbpmError::MarketNotOpen);
    Ok(())
}

pub fn validate_committee(
    members: &[Pubkey; MAX_COMMITTEE],
    member_count: u8,
    routine_threshold: u8,
    resolve_threshold: u8,
) -> Result<()> {
    require!(
        member_count >= 2 && (member_count as usize) <= MAX_COMMITTEE,
        IbpmError::InvalidCommittee
    );
    require!(
        routine_threshold >= 2 && routine_threshold <= member_count,
        IbpmError::InvalidCommittee
    );
    require!(
        resolve_threshold >= routine_threshold && resolve_threshold <= member_count,
        IbpmError::InvalidCommittee
    );
    for i in 0..member_count as usize {
        require!(members[i] != Pubkey::default(), IbpmError::InvalidCommittee);
        for j in 0..i {
            require!(members[i] != members[j], IbpmError::InvalidCommittee);
        }
    }
    for i in member_count as usize..MAX_COMMITTEE {
        require!(members[i] == Pubkey::default(), IbpmError::InvalidCommittee);
    }
    Ok(())
}

pub fn is_member(config: &Config, key: Pubkey) -> bool {
    let n = config.member_count as usize;
    n <= MAX_COMMITTEE && config.members[..n].contains(&key)
}

/// `payer` plus any extra signer accounts. Duplicate keys count once.
/// A signer who is not on the committee is rejected.
pub fn require_committee<'info>(
    config: &Config,
    payer: Pubkey,
    remaining: &[AccountInfo<'info>],
    threshold: u8,
) -> Result<()> {
    require!(threshold >= 1, IbpmError::InvalidCommittee);
    let mut seen = [Pubkey::default(); MAX_COMMITTEE];
    let mut n: usize = 0;

    let mut push = |key: Pubkey, is_signer: bool| -> Result<()> {
        if !is_signer {
            return Ok(());
        }
        require!(is_member(config, key), IbpmError::NotCommittee);
        if seen[..n].contains(&key) {
            return Ok(());
        }
        require!(n < MAX_COMMITTEE, IbpmError::InvalidCommittee);
        seen[n] = key;
        n += 1;
        Ok(())
    };

    push(payer, true)?;
    for acc in remaining {
        push(acc.key(), acc.is_signer)?;
    }
    require!(n >= threshold as usize, IbpmError::ThresholdNotMet);
    Ok(())
}

pub fn require_participant(user: &User) -> Result<()> {
    require!(
        user.kind == KIND_TRADER || user.kind == KIND_MAKER,
        IbpmError::NotAllowlisted
    );
    Ok(())
}

pub fn require_active(user: &User) -> Result<()> {
    require!(user.active, IbpmError::Inactive);
    require_participant(user)
}

pub fn require_kind(kind: u8) -> Result<()> {
    require!(
        kind == KIND_TRADER || kind == KIND_MAKER,
        IbpmError::InvalidAmount
    );
    Ok(())
}
