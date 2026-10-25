CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"wallet_address" text,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'observer' NOT NULL,
	"cohort_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"gies_balance" numeric(18, 6) DEFAULT '0' NOT NULL,
	"desk_balance" numeric(18, 6) DEFAULT '0' NOT NULL,
	"faucet_last_claimed" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "cohort_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"cohort_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cohorts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"teacher_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"resolution_criteria" text DEFAULT '' NOT NULL,
	"learning_panel" text,
	"category" text DEFAULT 'general' NOT NULL,
	"cohort_id" integer,
	"creator_id" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"yes_pool" numeric(18, 6) DEFAULT '500' NOT NULL,
	"no_pool" numeric(18, 6) DEFAULT '500' NOT NULL,
	"total_volume" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_liquidity" numeric(18, 6) DEFAULT '1000' NOT NULL,
	"lp_shares" numeric(18, 6) DEFAULT '1000' NOT NULL,
	"vault_collateral" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_yes_supply" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_no_supply" numeric(18, 6) DEFAULT '0' NOT NULL,
	"cumulative_fees" numeric(18, 6) DEFAULT '0' NOT NULL,
	"trading_fee_rate" numeric(6, 4) DEFAULT '0.02' NOT NULL,
	"max_fee_rate" numeric(6, 4) DEFAULT '0.05' NOT NULL,
	"max_price_impact" numeric(6, 4) DEFAULT '0.15' NOT NULL,
	"min_pool_depth" numeric(18, 6) DEFAULT '10' NOT NULL,
	"max_trade_size_pct" numeric(6, 4) DEFAULT '0.25' NOT NULL,
	"virtual_liquidity" numeric(18, 6) DEFAULT '400' NOT NULL,
	"virtual_liquidity_decay_volume" numeric(18, 6) DEFAULT '1000' NOT NULL,
	"resolves_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"side" text NOT NULL,
	"outcome" text NOT NULL,
	"token_amount" numeric(18, 6) NOT NULL,
	"gies_cost" numeric(18, 6) NOT NULL,
	"price_per_token" numeric(18, 6) NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"description" text NOT NULL,
	"tx_hash" text NOT NULL,
	"market_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lp_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"market_id" integer NOT NULL,
	"lp_shares" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_gies_provided" numeric(18, 6) DEFAULT '0' NOT NULL,
	"fees_earned" numeric(18, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"market_id" integer NOT NULL,
	"outcome" text NOT NULL,
	"token_amount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_cost_basis" numeric(18, 6) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(18, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "positions_user_id_market_id_outcome_unique" UNIQUE("user_id","market_id","outcome")
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"yes_price" numeric(18, 6) NOT NULL,
	"no_price" numeric(18, 6) NOT NULL,
	"volume" numeric(18, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_idea_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"idea_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "market_idea_votes_idea_id_user_id_unique" UNIQUE("idea_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "market_ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"submitted_by" integer NOT NULL,
	"cohort_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"badge_id" text NOT NULL,
	"awarded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_badges_user_id_badge_id_unique" UNIQUE("user_id","badge_id")
);
--> statement-breakpoint
CREATE TABLE "roster" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"cohort_label" text,
	"cohort_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"claimed" boolean DEFAULT false NOT NULL,
	"claimed_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roster_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "lp_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"taken_at" timestamp DEFAULT now() NOT NULL,
	"user_id" integer NOT NULL,
	"market_id" integer NOT NULL,
	"pool_share" numeric(12, 8) DEFAULT '0' NOT NULL,
	"deployed_value" numeric(18, 6) DEFAULT '0' NOT NULL,
	"market_cumulative_fees" numeric(18, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"routine_threshold" integer DEFAULT 2 NOT NULL,
	"resolve_threshold" integer DEFAULT 2 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"starter_amount" numeric(18, 6) DEFAULT '5000' NOT NULL,
	"maker_capital" numeric(18, 6) DEFAULT '15000' NOT NULL,
	"fee_base" numeric(6, 4) DEFAULT '0.02' NOT NULL,
	"fee_max" numeric(6, 4) DEFAULT '0.05' NOT NULL,
	"fee_match" numeric(6, 4) DEFAULT '0' NOT NULL,
	"reward_budget" numeric(18, 6) DEFAULT '0' NOT NULL,
	"treasury_balance" numeric(18, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" jsonb NOT NULL,
	"proposer_id" integer NOT NULL,
	"approvals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"executed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "reward_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reward_claims_claim_id_unique" UNIQUE("claim_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_challenges" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
