#!/usr/bin/env bash
# Read-only UPSTREAM-3 Worker helper: what Axiom and upstream each changed since the fork, for one path.
#   .axiom-work/scripts/upstream3-sides.sh <path> [--stat]
# Axiom side = fork point -> main at merge start; upstream side = fork point -> merge target (.axiom-work/upstream-3.target).
# For a file upstream moved or deleted, the dossier (.axiom-work/reports/UPSTREAM-3-dossier.md) names where it went.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
T=.axiom-work/upstream-3.target
B=$(awk '$1=="base"{print $2}' "$T"); O=$(awk '$1=="main"{print $2}' "$T"); U=$(awk '$1=="upstream"{print $2}' "$T")
P="${1:?usage: upstream3-sides.sh <path> [--stat]}"
FMT=(--no-color); [ "${2:-}" = "--stat" ] && FMT+=(--stat)
echo "### Axiom: fork point ${B:0:10} -> main ${O:0:10} -- $P"
git --no-pager log --format='  %h %s' "$B..$O" -- "$P" | head -12
git --no-pager diff "${FMT[@]}" "$B" "$O" -- "$P"
echo "### upstream: fork point ${B:0:10} -> ${U:0:10} -- $P"
git --no-pager log --format='  %h %s' "$B..$U" -- "$P" | head -12
git --no-pager diff "${FMT[@]}" "$B" "$U" -- "$P"
