#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm typecheck
# Database changes require an explicit, reviewed migration. Never push schema on merge.
