# iBlock Prediction Market (iBPM)

## Overview

A full-stack simulated prediction market platform for the Gies College of Business Derivatives & Trading Academy. Uses a simulated blockchain (no real Ethereum required) backed by PostgreSQL.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild
- **Frontend**: React + Vite (Tailwind, shadcn/ui, Recharts, Framer Motion)

## User Roles

- **student** — Browse and trade on markets, view portfolio, claim $GIES faucet
- **market_maker** — Same as student + provide/remove AMM liquidity, earn fees
- **teacher** — Create markets, manage cohorts, resolve outcomes, promote students
- **admin** — Full access + user management

## Login Credentials (seeded)

| Username | Password | Role |
|---|---|---|
| admin | admin123 | admin |
| prof_excell | teacher123 | teacher |
| alice_wang | student123 | student |
| bob_chen | student123 | market_maker |
| carol_kim | student123 | student |
| david_patel | student123 | market_maker |

## Structure

```text
artifacts/
├── api-server/         # Express 5 API server
│   └── src/
│       ├── lib/auth.ts     # Token auth, role guards
│       ├── lib/amm.ts      # AMM constant-product formula
│       └── routes/         # auth, users, cohorts, markets, trades, wallet, liquidity, leaderboard
├── ibpm/               # React + Vite frontend (at /)
│   └── src/
│       ├── contexts/AuthContext.tsx
│       ├── pages/         # Login, Dashboard, Markets, MarketDetail, Portfolio, Faucet, Liquidity, TeacherAdmin, Leaderboard
│       └── components/

lib/
├── api-spec/openapi.yaml   # OpenAPI contract (source of truth)
├── api-client-react/       # Generated React Query hooks
├── api-zod/                # Generated Zod schemas
└── db/src/schema/
    ├── users.ts
    ├── cohorts.ts
    ├── markets.ts
    ├── trades.ts
    ├── transactions.ts
    └── positions.ts

scripts/src/seed.ts         # Database seeder
```

## Key Concepts

### AMM (Automated Market Maker)
- Constant product formula: `yesPool × noPool = k`
- YES price = `noPool / (yesPool + noPool)` → represents market probability
- NO price = `yesPool / (yesPool + noPool)`
- 2% trading fee on each trade
- Fees split between the pool (LPs benefit)

### $GIES Token
- Simulated ERC-20 equivalent — balances stored in PostgreSQL
- Faucet dispenses 500 $GIES every 24 hours
- All trades, liquidity, and redemptions recorded as blockchain-style transactions

### Market Lifecycle
1. Teacher creates market with initial liquidity → AMM initialized at 50/50
2. Students trade YES/NO tokens, prices shift with each trade
3. Market makers add liquidity to earn fees
4. Teacher closes market → no more trading
5. Teacher resolves market (YES or NO) → winners redeem 1 $GIES per token

## Running

```bash
# API server (port auto-assigned)
pnpm --filter @workspace/api-server run dev

# Frontend
pnpm --filter @workspace/ibpm run dev

# Seed database (run once)
pnpm --filter @workspace/scripts run seed

# Push DB schema changes
pnpm --filter @workspace/db run push
```

## Production migrations

Handled by Replit on publish. In development: `pnpm --filter @workspace/db run push`.
