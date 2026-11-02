#!/usr/bin/env bash
# Run once in EACH clone (e.g. ~/work/me/royalty-ledger and ~/work/mate/royalty-ledger).
# Activates the attribution guards and checks this clone's git identity.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

chmod +x .githooks/commit-msg .githooks/pre-push
git config core.hooksPath .githooks

name="$(git config user.name || true)"
email="$(git config user.email || true)"
if [ -z "$name" ] || [ -z "$email" ]; then
    echo "Set this clone's identity first:"
    echo "  git config user.name  \"YOUR NAME\""
    echo "  git config user.email \"YOUR_GITHUB_EMAIL\""
    exit 1
fi
if printf '%s %s' "$name" "$email" | grep -qi -E 'claude|anthropic'; then
    echo "This clone's identity looks like Claude/Anthropic ($name <$email>). Set your own."
    exit 1
fi
echo "OK  hooks active (core.hooksPath=$(git config core.hooksPath))"
echo "OK  identity : $name <$email>"
echo "OK  remote   : $(git remote get-url origin 2>/dev/null || echo '(none yet)')"
