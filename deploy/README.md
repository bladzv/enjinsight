# Scheduled Staking Cadence scan

Runs `scripts/enjinsight_cli.py` once a day, scanning validator cadence and then
nomination-pool cadence, and posting each result to Slack with the scan export
attached. Each report is sent as soon as its scan finishes, so a failure in the
second does not cost you the first.

The attached JSON is the web app's import envelope — drag it into **Staking
Cadence → Import** to open the scan in the UI.

## 1. Requirements

- Python 3.9+ with `requests` and `websockets`:
  ```bash
  pip install requests websockets
  ```
  `rich` (pretty output), `python-dotenv` (loads `.env` outside systemd) and
  `cryptography` (encrypted exports) are optional — the CLI degrades gracefully
  without them.
- A Subscan API key.
- A Slack app (free plan is fine). See the setup steps in `.env.example`.

## 2. Configure

Copy `.env.example` to `.env` and fill in at minimum:

```ini
SUBSCAN_API_KEY=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C01ABC2DEFG
```

Every `CADENCE_*` and `SLACK_*` key is documented inline in `.env.example`.

> `EnvironmentFile=` is stricter than dotenv: `#` starts a comment only at the
> beginning of a line, there is no `export` prefix, and no shell interpolation.
> Keep your `.env` in that shape or systemd will read comments as values.

## 3. Try it by hand first

```bash
# ~20 seconds: 3 validators and 3 pools, writes files, posts nothing
python3 scripts/enjinsight_cli.py --non-interactive --mode both \
    --eras 1 --limit 3 --export json --dry-run --out ./scan-output
```

Then a real run into a test channel before pointing it at the real one:

```bash
python3 scripts/enjinsight_cli.py --non-interactive --mode both \
    --eras 1 --export json --slack-channel C_TEST_CHANNEL
```

`--help` lists every flag. Anything not passed falls back to `.env`, then to a
built-in default.

## 4. Install the timer

```bash
sudo cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start cadence-scan.service     # one full run, in the real unit env
journalctl -u cadence-scan -f                 # watch it
sudo systemctl enable --now cadence-scan.timer
systemctl list-timers cadence-scan            # confirm the next fire time
```

Edit `User=`, `WorkingDirectory=`, `EnvironmentFile=` and `ReadWritePaths=` in
`cadence-scan.service` to match your install first.

### About the schedule

The timer fires at **18:00 UTC**. This is deliberate, not arbitrary.

Enjin era boundaries fall at ~19:13:54 UTC (14400 blocks × 6 s = exactly 24 h —
see `public/relay-era-reference.csv`). Rewards for era N are paid *during* era
N+1, so scanning too soon after a boundary means reading a payout window that is
minutes old, and every pool looks unpaid. At 18:00 the era being scanned closed
~23 h ago and its payout window has been open for nearly a full era.

The scan still labels the newest era **provisional** when its payout window has
not closed, in the log, the Slack message and the export's `meta.provisionalEra`
— so a pool flagged there may simply not have been paid yet. Never treat a
provisional-era miss as an incident.

> `OnCalendar` evaluates in the **server's local timezone**. The unit uses an
> explicit `UTC` suffix, which needs systemd ≥ 252 (`systemctl --version`). On
> older systemd, drop the suffix and convert 18:00 UTC to local time yourself.
> Check with `systemd-analyze calendar "*-*-* 18:00:00 UTC"` before enabling.

## 5. Failure handling

Two independent alerts, and you can disable either:

| Source | Catches | Disable with |
|---|---|---|
| The script itself | Errors it can catch: bad API key, unreachable endpoint, failed scan | `SLACK_NOTIFY_ON_FAILURE=false` |
| `cadence-scan-failure.service` (`OnFailure=`) | Everything else: missing interpreter, unreadable `.env`, OOM, timeout | remove `OnFailure=` from the unit |

## 6. Notes

- **No era CSV or archive node needed.** The cadence scan resolves era block
  ranges from Subscan `era_stat` alone, cross-checking several validators for
  consensus. A stale checkout cannot corrupt it and the server never needs a
  `git pull` to stay correct.
- **Cost.** About 315 Subscan requests per day at `--eras 1`, against the free
  tier's 20,000/day — roughly 1.6%. A full run takes ~6 minutes.
- **Exports are always written to disk**, even with `SLACK_ATTACH_EXPORT=false`.
  Slack's free plan hides files after 90 days, so `CADENCE_OUT_DIR` is the
  durable archive. `CADENCE_KEEP_DAYS` prunes it after each run.
