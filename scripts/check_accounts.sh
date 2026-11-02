#!/usr/bin/env bash
# Verifies the two-account setup before any commit/PR work.
# Reads ~/work/accounts.env (template: scripts/accounts.env.example). Exit 1 on any FAIL.
set -u
ENV_FILE="${ACCOUNTS_ENV:-$HOME/work/accounts.env}"
if [ ! -f "$ENV_FILE" ]; then echo "FAIL  $ENV_FILE missing (copy scripts/accounts.env.example and fill it in)"; exit 1; fi
# shellcheck disable=SC1090
. "$ENV_FILE"

fail=0
ok()   { echo "OK    $*"; }
bad()  { echo "FAIL  $*"; fail=1; }

for P in ME MATE; do
    d="${P}_DIR"; n="${P}_NAME"; e="${P}_EMAIL"; g="${P}_GH"; alias="${P}_SSH_ALIAS"
    dir="${!d:-}"; name="${!n:-}"; email="${!e:-}"; gh_user="${!g:-}"; host="${!alias:-}"
    echo "== $P ($name)"
    [ -n "$dir" ] && [ -d "$dir/.git" ] || { bad "$P clone not found at '$dir'"; continue; }
    [ "$(git -C "$dir" config user.name)"  = "$name"  ] && ok "user.name = $name"   || bad "user.name is '$(git -C "$dir" config user.name)', expected '$name'"
    [ "$(git -C "$dir" config user.email)" = "$email" ] && ok "user.email = $email" || bad "user.email is '$(git -C "$dir" config user.email)', expected '$email'"
    [ "$(git -C "$dir" config core.hooksPath)" = ".githooks" ] && ok "hooks active" || bad "core.hooksPath not .githooks (run scripts/setup_git_guards.sh in $dir)"
    url="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
    case "$url" in
        git@"$host":*) ok "origin uses $host" ;;
        *) bad "origin is '$url', expected git@$host:..." ;;
    esac
    if printf '%s %s' "$name" "$email" | grep -qi -E 'claude|anthropic'; then bad "identity looks like Claude/Anthropic"; fi
done

if command -v gh >/dev/null 2>&1; then
    status="$(gh auth status 2>&1 || true)"
    for P in ME MATE; do
        g="${P}_GH"; u="${!g:-}"
        if printf '%s' "$status" | grep -q "account $u"; then ok "gh is logged in as $u"; else bad "gh not logged in as '$u' (run: gh auth login)"; fi
    done
    active="$(printf '%s\n' "$status" | awk '/Logged in to github.com account/{a=$NF} /Active account: true/{print a}' | tr -d '()')"
    [ -n "$active" ] && echo "INFO  gh active account: $active"
else
    bad "gh (GitHub CLI) not installed (brew install gh)"
fi

[ "$fail" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit "$fail"
