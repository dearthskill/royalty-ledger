#!/usr/bin/env bash
# Re-export docs/er-diagram.png from the Mermaid block in docs/DESIGN.md (ELK layout, white background).
# Usage: scripts/render_er.sh      (needs Node; downloads @mermaid-js/mermaid-cli via npx on first run)
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
{ printf -- '---\nconfig:\n  layout: elk\n---\n'
  awk '/^```mermaid/{f=1;next} /^```/{if(f){exit}} f' docs/DESIGN.md; } > "$tmp/er.mmd"
npx -y @mermaid-js/mermaid-cli -i "$tmp/er.mmd" -o docs/er-diagram.png -b white -w 2400 -s 2
rm -rf "$tmp"
echo "Wrote docs/er-diagram.png"
