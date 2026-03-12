#!/bin/bash
# RAG Auto-Optimizer — Nightly Build Agent
# Runs claude -p with the optimizer skill prompt via launchd
# Logs to scripts/logs/nightly-YYYY-MM-DD.log

set -euo pipefail

PROJECT_DIR="/Users/chrisgscott/projects/RAG-boilerplate"
LOG_DIR="$PROJECT_DIR/scripts/logs"
LOG_FILE="$LOG_DIR/nightly-$(date +%Y-%m-%d).log"

# launchd runs with minimal PATH — set up homebrew, nvm, pnpm
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Ensure we're not detected as a nested session (launchd won't have this, but manual testing might)
unset CLAUDECODE

# Load nvm if available (needed for node/pnpm)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

mkdir -p "$LOG_DIR"

echo "=== Nightly Optimizer — $(date) ===" >> "$LOG_FILE"

PROMPT='You are running the nightly RAG Auto-Optimizer build session for /Users/chrisgscott/projects/RAG-boilerplate.

Invoke the skill "rag-auto-optimizer-nightly" and follow its instructions exactly. The skill will guide you through:

1. Reading AUTO-OPTIMIZE.md and AUTO-OPTIMIZE-BUILD-STATE.md for current state
2. Running baseline backpressure (vitest, tsc, build)
3. Picking the next unchecked task from the active phase
4. Implementing it using strict TDD (red-green-refactor)
5. Running full backpressure, committing locally (no push)
6. Updating AUTO-OPTIMIZE-BUILD-STATE.md with completed work
7. Writing a morning briefing to AUTO-OPTIMIZE-BRIEFING.md

All work happens in /Users/chrisgscott/projects/RAG-boilerplate. Do not push to remote — local commits only.

Stop after completing one task or after 90 minutes, whichever comes first. Never end with failing tests, a broken build, or uncommitted changes.'

cd "$PROJECT_DIR"

/opt/homebrew/bin/claude -p "$PROMPT" \
  --permission-mode auto \
  --max-budget-usd 20.00 \
  --output-format json \
  >> "$LOG_FILE" 2>&1

echo "=== Completed — $(date) ===" >> "$LOG_FILE"
