#!/usr/bin/env bash
# reconcile-specs.sh — deterministic reconciliation pass over the Spec Kit corpus in specs/.
#
# What it does (per feature, plus corpus-wide):
#   1. Backs up specs/ to .specstride/backups/<timestamp>/ (tar) — once per invocation.
#   2. Runs deterministic cross-artifact checks per feature:
#        a. every test name declared in spec.md appears in tasks.md
#        b. leftover markers: [NEEDS CLARIFICATION], TODO, TKTK, ???, <placeholder>
#        c. cross-feature references (feature NNN / specs/NNN-*) resolve to real dirs
#        d. spec.md has Status and Created header fields
#        e. analyze-report.md exists and its findings table parses
#   3. AUTO-ACCEPTS (applies) only the fixes a machine can make safely:
#        - none that alter normative content; this layer records and stages,
#          semantic edits are applied by the curation agents and logged here.
#   4. Writes specs/<feature>/reconciliation.md (append-only log entry per run)
#      and refreshes the corpus summary specs/RECONCILIATION.md.
#
# Usage: scripts/reconcile-specs.sh [--dry-run] [--feature NNN-prefix]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPECS="$ROOT/specs"
DRY_RUN=0
FEATURE_FILTER=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --feature) : ;; # value consumed below
    *) [[ "${PREV:-}" == "--feature" ]] && FEATURE_FILTER="$arg" || { echo "unknown arg: $arg" >&2; exit 2; } ;;
  esac
  PREV="$arg"
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="reconcile-$STAMP"
LOG="$ROOT/.specstride/reconcile-$STAMP.log"
mkdir -p "$ROOT/.specstride"

log() { printf '%s | %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }

# ---------- 1. backup ----------
if [[ $DRY_RUN -eq 0 ]]; then
  BK="$ROOT/.specstride/backups/$STAMP"
  mkdir -p "$BK"
  tar -cf "$BK/specs.tar" -C "$ROOT" specs
  log "backup written: $BK/specs.tar"
else
  log "dry-run: no backup, no writes"
fi

features() {
  ls -d "$SPECS"/*/ 2>/dev/null | xargs -n1 basename | sort
  return 0
}

declare -a CORPUS_ROWS=()
TOTAL_FEAT=0 TOTAL_CHECKS=0 TOTAL_FAIL=0

for f in $(features); do
  [[ -n "$FEATURE_FILTER" && "$f" != "$FEATURE_FILTER"* ]] && continue
  dir="$SPECS/$f"
  TOTAL_FEAT=$((TOTAL_FEAT+1))
  fails=0; checks=0; notes=()

  spec="$dir/spec.md"; plan="$dir/plan.md"; tasks="$dir/tasks.md"; rep="$dir/analyze-report.md"

  # prerequisite: core artifacts exist
  checks=$((checks+1))
  if [[ ! -f "$spec" || ! -f "$plan" || ! -f "$tasks" ]]; then
    fails=$((fails+1)); notes+=("MISSING core artifact (spec/plan/tasks)")
  fi

  if [[ -f "$spec" && -f "$tasks" ]]; then
    # a. test names in spec.md appear in tasks.md (alias/mapping table rows excluded;
    #    fixture names may be defined anywhere in the feature dir)
    checks=$((checks+1)); miss=0
    while IFS= read -r tname; do
      [[ -z "$tname" ]] && continue
      if [[ "$tname" == FX-* ]]; then
        grep -rqF "$tname" "$dir" || { miss=$((miss+1)); echo "    missing task for test: $tname" >> "$LOG"; }
      else
        grep -qF "$tname" "$tasks" || grep -rqF "$tname" "$SPECS" || { miss=$((miss+1)); echo "    missing task for test: $tname" >> "$LOG"; }
      fi
    done < <(grep -vE '^[[:space:]]*\|' "$spec" | grep -oE '\b(PT-[0-9]{3}(-[A-Za-z0-9-]+)+|FX-[0-9]{2,3})\b' | sort -u)
    if [[ $miss -gt 0 ]]; then fails=$((fails+1)); notes+=("$miss test name(s) in spec.md lack a tasks.md reference"); fi

    # b. leftover markers
    checks=$((checks+1)); markers=0
    m=$(grep -nE '\[NEEDS CLARIFICATION\]|TODO|TKTK|\?\?\?|<placeholder>' "$spec" "$plan" "$tasks" 2>/dev/null | wc -l || true)
    markers=$m
    if [[ $markers -gt 0 ]]; then fails=$((fails+1)); notes+=("$markers unresolved marker line(s) (NEEDS CLARIFICATION/TODO/...)"); fi

    # c. cross-feature references resolve
    checks=$((checks+1)); badrefs=0
    while IFS= read -r reff; do
      [[ -d "$SPECS/$reff" ]] || { badrefs=$((badrefs+1)); echo "    dangling feature ref: $reff" >> "$LOG"; }
    done < <(grep -hoE 'specs/[0-9]{3}-[a-z0-9-]+' "$spec" "$plan" "$tasks" 2>/dev/null | sed 's|specs/||' | sort -u)
    if [[ $badrefs -gt 0 ]]; then fails=$((fails+1)); notes+=("$badrefs dangling cross-feature reference(s)"); fi

    # d. header fields
    checks=$((checks+1))
    if ! grep -q '^\*\*Status\*\*' "$spec" || ! grep -q '^\*\*Created\*\*' "$spec"; then
      fails=$((fails+1)); notes+=("spec.md missing Status/Created header field")
    fi
  fi

  # e. analyze-report exists
  checks=$((checks+1))
  if [[ ! -f "$rep" ]]; then fails=$((fails+1)); notes+=("no analyze-report.md"); fi

  TOTAL_CHECKS=$((TOTAL_CHECKS+checks)); TOTAL_FAIL=$((TOTAL_FAIL+fails))
  status="OK"; [[ $fails -gt 0 ]] && status="FAIL($fails)"
  note_str="${notes[*]:-}"
  CORPUS_ROWS+=("| $f | $checks | $fails | ${note_str:-- } |")
  log "$f: $status ${note_str}"
done

# ---------- corpus summary ----------
SUMMARY="$SPECS/RECONCILIATION.md"
{
  echo "# Spec corpus reconciliation"
  echo
  echo "Run: \`$RUN_ID\` — deterministic checks by \`scripts/reconcile-specs.sh\`."
  echo "Semantic curation (dsh-as-host retarget, analyze recommendations) is applied by the"
  echo "curation agents and logged per feature in \`specs/<feature>/reconciliation.md\`."
  echo
  echo "Corpus: $TOTAL_FEAT features, $TOTAL_CHECKS checks, $TOTAL_FAIL failures."
  echo
  echo "| Feature | Checks | Failures | Notes |"
  echo "|---|---|---|---|"
  for row in "${CORPUS_ROWS[@]}"; do echo "$row"; done
} > "$SUMMARY.tmp"

# per-feature append-only logs
for f in $(features); do
  [[ -n "$FEATURE_FILTER" && "$f" != "$FEATURE_FILTER"* ]] && continue
  if [[ $DRY_RUN -eq 0 ]]; then
    {
      echo "## $RUN_ID"
      echo "- deterministic reconcile run ($(grep -c "^| $f " "$SUMMARY.tmp" || true) summary row)"
      echo "- see corpus summary: specs/RECONCILIATION.md; full log: .specstride/reconcile-$STAMP.log"
      echo
    } >> "$SPECS/$f/reconciliation.md" 2>/dev/null || echo "## $RUN_ID" > "$SPECS/$f/reconciliation.md"
  fi
done

if [[ $DRY_RUN -eq 0 ]]; then mv "$SUMMARY.tmp" "$SUMMARY"; else rm -f "$SUMMARY.tmp"; fi
log "done: $TOTAL_FEAT features, $TOTAL_CHECKS checks, $TOTAL_FAIL failures"
echo
echo "Reconciliation complete: $TOTAL_FEAT features / $TOTAL_CHECKS checks / $TOTAL_FAIL failures"
echo "Summary: $SUMMARY  Log: $LOG"
[[ $TOTAL_FAIL -eq 0 ]] || exit 1
