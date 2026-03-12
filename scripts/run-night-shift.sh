#!/bin/bash
# Watch the night shift work — live terminal output
# Usage: ./scripts/run-night-shift.sh

set -euo pipefail

cd /Users/chrisgscott/projects/RAG-boilerplate
unset CLAUDECODE 2>/dev/null || true

echo "🌙 Night shift clocking in..."
echo ""

claude -p 'You are running the nightly RAG Auto-Optimizer build session for /Users/chrisgscott/projects/RAG-boilerplate.

Invoke the skill "rag-auto-optimizer-nightly" and follow its instructions exactly. The skill will guide you through:

1. Reading AUTO-OPTIMIZE.md and AUTO-OPTIMIZE-BUILD-STATE.md for current state
2. Running baseline backpressure (vitest, tsc, build)
3. Picking the next unchecked task from the active phase
4. Implementing it using strict TDD (red-green-refactor)
5. Running full backpressure, committing locally (no push)
6. Updating AUTO-OPTIMIZE-BUILD-STATE.md with completed work
7. Writing a morning briefing to AUTO-OPTIMIZE-BRIEFING.md

All work happens in /Users/chrisgscott/projects/RAG-boilerplate. Do not push to remote — local commits only.

Stop after completing one task or after 90 minutes, whichever comes first. Never end with failing tests, a broken build, or uncommitted changes.' \
  --permission-mode auto \
  --max-budget-usd 20.00

echo ""
echo "🌙 Night shift clocked out."
