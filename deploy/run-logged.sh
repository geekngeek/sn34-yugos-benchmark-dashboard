#!/usr/bin/env bash
# Run a command and append its output (stdout + stderr) to a log file, one timestamp per line.
# Usage: run-logged.sh <logfile> <command> [args...]
set -o pipefail
log="$1"; shift
mkdir -p "$(dirname "$log")"
echo "$(date '+%F %T') ===== starting: $* =====" >> "$log"
"$@" 2>&1 | gawk '{ print strftime("%F %T"), $0; fflush() }' >> "$log"
