pub const CONFIG_SEED: &[u8] = b"config";
pub const MINT_SEED: &[u8] = b"gies_mint";
pub const USER_SEED: &[u8] = b"user";
pub const DESK_SEED: &[u8] = b"desk";
pub const MARKET_SEED: &[u8] = b"market";
pub const VAULT_SEED: &[u8] = b"vault";
pub const POS_SEED: &[u8] = b"pos";
pub const LP_SEED: &[u8] = b"lp";

pub const GIES_DECIMALS: u8 = 6;
pub const GIES: u64 = 1_000_000;
pub const STARTER_AMOUNT: u64 = 5_000 * GIES;
pub const DESK_AMOUNT: u64 = 15_000 * GIES;

pub const ROLE_STUDENT: u8 = 0;
pub const ROLE_MAKER: u8 = 1;
pub const ROLE_TEACHER: u8 = 2;
pub const ROLE_ADMIN: u8 = 3;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_CLOSED: u8 = 1;
pub const STATUS_RESOLVED: u8 = 2;

pub const OUTCOME_NONE: u8 = 0;
pub const OUTCOME_YES: u8 = 1;
pub const OUTCOME_NO: u8 = 2;

pub const DEFAULT_MAX_IMPACT_BPS: u16 = 1_500;
pub const DEFAULT_MIN_POOL_DEPTH: u64 = 10 * GIES;
pub const DEFAULT_MAX_TRADE_BPS: u16 = 2_500;
