# iBlock-Prediction-Market

iBlock Prediction Market — Product Spec
Platform: Web app (React + Vite) · Audience: University students & instructors · Context: Gies Derivatives & Trading Academy simulation

What It Is
iBlock is a simulated prediction market platform for finance education. Students trade on real-world questions using a fake currency ($GIES tokens), experiencing firsthand how market prices aggregate collective belief — and how fees, liquidity, and position-sizing affect outcomes. Teachers create and resolve markets; students trade, compete on leaderboards, and learn through consequence.

Core Mechanics
$GIES Token
The in-app currency. Students start with 1,000 $GIES. They can top up via a faucet (500 $GIES per 24 hours). All trades, positions, and P&L are denominated in $GIES — there's no on-chain settlement.
Prediction Markets
Each market is a YES/NO question with a resolution deadline set by a teacher. Markets are organized into cohorts (classes) so teachers can scope which students see which markets.
Automated Market Maker (AMM)
Prices are set algorithmically using a constant-product formula (same math as Uniswap). Each market has a YES pool and a NO pool; the ratio determines the price. Buying YES tokens shifts the price upward; selling shifts it down. There is no order book — the pool is always available.
Dynamic Fees
A base 2% fee scales up quadratically toward 5% as the market moves toward extremes (0% or 100% probability). This teaches students that trading at conviction is costly and models realistic bid-ask spread dynamics.
Safeguards
Per-market circuit breakers block trades that would cause >15% price impact, drain pools below a minimum depth, or exceed 25% of total pool size in one trade. Teachers can tune these parameters per market.
Liquidity
Teachers and designated market-makers seed pools with $GIES, split evenly between YES and NO sides. LPs receive shares proportional to their contribution and can withdraw their pro-rata portion of the pool at any time.
Resolution & Payout
Teachers resolve markets by declaring YES or NO. Winning token holders receive 1 $GIES per token; losing tokens go to zero. Students redeem through their wallet.

User Roles
Role
Can do
Student
Trade, claim faucet, view portfolio, comment on markets
Teacher
All of the above + create/resolve/close markets, manage cohorts, view safeguard event dashboard
Admin
All of the above + user management, promote users
Market Maker
Provide/remove liquidity


Current Feature Set
Username/password login · Role-based access control
Market creation with resolution criteria, learning panel, per-market safeguard config
AMM trading with live price quotes, price impact warnings, and trade history
Portfolio page with unrealized/realized P&L per position
Price history charts per market
Leaderboard (global and per-cohort)
$GIES faucet with 24-hour cooldown
Liquidity provisioning with LP share tracking
Market comments/discussion per market
Teacher admin panel: create markets, resolve, close, adjust safeguards

In Progress / Roadmap
Onboarding flow — Email OTP signup, auto-wallet creation, gamified wallet education journey (Step 1: see your wallet +100 $GIES, Step 2: send tokens to a friend +200 $GIES, Step 3: claim faucet +50 $GIES)
@mention in comments — Tag classmates in market discussions
Pinned teacher comments — Surface instructor notes at top of discussion
Discussion activity indicator — Show comment count/recency on market cards
Safeguard event dashboard — Live teacher view of triggered circuit breakers
Mobile app — Expo/React Native port
Illinois brand charts — Theming price history charts to Illini colors
Automated trading engine tests — Regression coverage for AMM and safeguard logic

Tech Stack
Frontend: React, Vite, TanStack Query, Wouter, Tailwind, shadcn/ui
Backend: Node.js, Express, Drizzle ORM, PostgreSQL
API: OpenAPI spec → Orval-generated type-safe client hooks
Monorepo: pnpm workspaces (shared db, api-client-react, api-spec, api-zod packages)

No real money, no real blockchain. All settlement is simulated. Designed for a single university cohort running one semester at a time
