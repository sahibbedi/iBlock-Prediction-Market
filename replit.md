# iBPM campus version

The current architecture and setup are in [README.md](README.md) and [docs/integration.md](docs/integration.md).

Packages are at the repository root. Use pnpm from the root. The old `artifacts/` and `lib/` paths, teacher tier, maker rotations, faucet, and automatic schema push on merge are no longer part of the campus flow.

The app defaults to database mode. Solana is a separate execution backend with a shared frontend client. Deployments must explicitly configure the chosen backend, database, secret, and frontend/API routing. Production migrations and Solana deployment are operator steps, not automatic publish hooks.
