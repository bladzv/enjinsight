#!/bin/sh
# Post a one-line Slack alert that the cadence scan failed.
#
# Invoked by cadence-scan-failure.service via OnFailure=. Kept as a script
# rather than an inline ExecStart because systemd does NOT run ExecStart through
# a shell: redirections, here-strings and pipes are taken literally and the
# command silently never runs.
#
# Reads SLACK_BOT_TOKEN and SLACK_CHANNEL_ID from the environment (the unit
# supplies them via EnvironmentFile=).
set -eu

if [ -z "${SLACK_BOT_TOKEN:-}" ] || [ -z "${SLACK_CHANNEL_ID:-}" ]; then
    echo "notify-failure: SLACK_BOT_TOKEN or SLACK_CHANNEL_ID unset; nothing to notify." >&2
    exit 0
fi

UNIT="${1:-cadence-scan}"
TEXT="❌ EnjinSight ${UNIT}.service failed. Inspect: journalctl -u ${UNIT} -n 100"

# Slack answers logical failures with HTTP 200 and {"ok":false}, so echo the
# response into the journal rather than trusting the exit status.
curl -sS -X POST https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
    -H "Content-type: application/json; charset=utf-8" \
    --data "$(printf '{"channel":"%s","text":"%s"}' "$SLACK_CHANNEL_ID" "$TEXT")"
echo
