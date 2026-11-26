#!/usr/bin/env bash
# Install (or update) the background services and log rotation. Run as root.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cp "$here/llm-bench-api.service" "$here/llm-bench-dashboard.service" /etc/systemd/system/
cp "$here/llm-bench.logrotate" /etc/logrotate.d/llm-bench
docker update --restart unless-stopped llm-bench-db >/dev/null   # database starts with Docker on boot
systemctl daemon-reload
systemctl enable --now llm-bench-api.service llm-bench-dashboard.service
systemctl restart llm-bench-api.service llm-bench-dashboard.service
systemctl --no-pager --lines=0 status llm-bench-api.service llm-bench-dashboard.service
