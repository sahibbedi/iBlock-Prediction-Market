# iBlock Prediction Market

Campus prediction markets with an admin committee, enrolled traders, dedicated market makers, and read-only observers. There are no maker rotations in the campus flow.

Start with [the integration handoff](docs/integration.md). The short, shareable version is [the PDF](output/pdf/ibpm-campus-integration.pdf).

## Packages

- `ibpm`: React/Vite app. `/admin` is the committee console.
- `api-server`: Express API and database-mode market execution.
- `db`: Drizzle schema and migrations for a **new campus database**.
- `api-spec`, `api-client-react`, `api-zod`: OpenAPI and generated clients/schemas.
- `solana`: Anchor 0.32.1 program, unit tests, local validator tests, and generated IDL.
- `solana/client`: `@workspace/solana-client`, shared wallet/instruction helpers for the frontend.
- `scripts`: empty-database committee bootstrap, optional roster import, reward previews, API integration tests.

## Local web setup

Use Node 24+, pnpm 9.12.2, and PostgreSQL 14+. Export `DATABASE_URL`, a random `AUTH_SECRET` of at least 32 characters, and `APP_ORIGIN` (see `.env.example`).

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/db migrate
# COMMITTEE_MEMBERS is a JSON array supplied securely in the environment:
# [{"username":"...","displayName":"...","email":"...","password":"..."}, ...]
# Supply 2-7 members, unique usernames, passwords of at least 12 characters.
pnpm --filter @workspace/scripts seed
PORT=3001 pnpm --filter @workspace/api-server dev
# In a separate terminal:
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/ibpm dev
```

The bootstrap refuses a nonempty users table. Starting balances are 5,000 GIES; the default maker capital policy is 15,000 GIES. Makers must be appointed and funded through separate committee proposals. The initial treasury is empty. The committee authorizes reward budgets and payouts.

**Existing beta data:** do not apply the fresh-campus baseline over a populated beta database. Back it up and retain it separately. The campus schema removes rotation columns and the teacher role; balances, open claims, and prior capital grants need a reviewed migration if they are carried forward. Nothing here runs a production migration automatically.

## Checks

```sh
pnpm build
pnpm test
pnpm --filter ibpm-program test:math
pnpm --filter ibpm-program build
pnpm --filter ibpm-program idl
pnpm --filter ibpm-program typecheck
pnpm --filter ibpm-program test:client
pnpm --filter ibpm-program test
```

The Anchor test starts a local validator and includes a local program upgrade. It refuses to run the upgrade case against a public RPC. Install Solana CLI/SBF tools and Anchor 0.32.1 for these commands; the build pins SBF tools v1.52. All JavaScript packages use the root pnpm lockfile.

For API integration tests, create the disposable local database `ibpm_campus_test`, apply migrations to it, and export its URL with host **127.0.0.1** before running `pnpm test:api`. The tests explicitly refuse other database names/hosts and reset only their test tables.

`MARKET_BACKEND=database` runs the database version. `MARKET_BACKEND=solana` blocks legacy financial endpoints so a frontend cannot silently read or mutate a second ledger. Connect the wallet client and chain indexer before enabling that mode. It does not deploy the program or wire wallet UI automatically.
