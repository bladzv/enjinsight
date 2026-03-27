#!/usr/bin/env python3
"""
Enjin Era Reference Builder
============================
Automatically maintains relay-era-reference.csv with era start/end blocks,
block hashes, and UTC timestamps for every era on the Enjin Relaychain.

Run with no arguments — the script figures out what to do on its own:

  • If relay-era-reference.csv does not exist, it queries the archive node for
    every era from era 1 up to the current chain era and creates the file.

  • If relay-era-reference.csv already exists, it reads the latest era recorded,
    then fetches only the subsequent eras and appends them. Any previously
    current era whose end_block was left blank is also back-filled.

Usage:
    python relay-era-reference.py
    python relay-era-reference.py --endpoint wss://your-node

Output: relay-era-reference.csv
    era               - Era index
    start_block       - First block of this era
    end_block         - Last block of this era (blank if era is still ongoing)
    start_block_hash     - Hash of the start block (eliminates repeated get_block_hash calls)
    start_timestamp_unix - Unix timestamp in ms of the start block
    start_datetime_utc   - UTC datetime of the start block (ISO 8601)
    end_timestamp_unix   - Unix timestamp in ms of the end block
    end_datetime_utc     - UTC datetime of the end block (ISO 8601, blank if ongoing)

Requirements:
    pip install substrate-interface

Environment variables:
    RPC_ENDPOINT    Archive node WebSocket URL (overrides default)
"""

import argparse
import csv
import os
import sys
import time
import ssl
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from substrateinterface import SubstrateInterface
except ImportError:
    print("ERROR: 'substrate-interface' package not found.")
    print("Install it with: pip install substrate-interface")
    sys.exit(1)

ENJ_SS58_PREFIX  = 2135
DEFAULT_ENDPOINT = os.getenv("RPC_ENDPOINT", "wss://archive.relay.blockchain.enjin.io")

# Resolve CSV path relative to this script's location so it always writes to
# <project-root>/public/relay-era-reference.csv regardless of the working directory.
_SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_SCRIPT_DIR)
CSV_FILE     = os.path.join(_PROJECT_ROOT, 'public', 'relay-era-reference.csv')


# ── CSV helpers ───────────────────────────────────────────────────────────────

CSV_COLUMNS = ['era', 'start_block', 'end_block', 'start_block_hash',
               'start_timestamp_unix', 'start_datetime_utc',
               'end_timestamp_unix',   'end_datetime_utc']


def _ms_to_iso(ms):
    # type: (object) -> str
    """Convert Unix millisecond timestamp to ISO 8601 UTC string."""
    if ms is None:
        return ''
    try:
        dt = datetime.fromtimestamp(int(ms) / 1000.0, tz=timezone.utc)
        return dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    except (TypeError, ValueError, OSError):
        return ''


def read_csv():
    # type: () -> list
    """Read relay-era-reference.csv and return a list of row dicts sorted by era."""
    rows = []
    try:
        with open(CSV_FILE, newline='', encoding='utf-8') as f:
            for row in csv.DictReader(f):
                try:
                    era         = int(row['era'])
                    start_block = int(row['start_block'])
                    end_str     = row.get('end_block', '').strip()
                    end_block   = int(end_str) if end_str else None
                    su = row.get('start_timestamp_unix', '').strip()
                    eu = row.get('end_timestamp_unix',   '').strip()
                    rows.append({
                        'era':                  era,
                        'start_block':          start_block,
                        'end_block':            end_block,
                        'start_block_hash':     row.get('start_block_hash', '').strip() or None,
                        'start_timestamp_unix': int(su) if su else None,
                        'start_datetime_utc':   (row.get('start_datetime_utc') or row.get('start_datetime') or '').strip() or None,
                        'end_timestamp_unix':   int(eu) if eu else None,
                        'end_datetime_utc':     (row.get('end_datetime_utc') or row.get('end_datetime') or '').strip() or None,
                    })
                except (KeyError, ValueError):
                    continue
    except FileNotFoundError:
        pass
    return sorted(rows, key=lambda r: r['era'])


def write_csv(rows):
    # type: (list) -> None
    """Write all rows to relay-era-reference.csv, overwriting any previous content."""
    with open(CSV_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(CSV_COLUMNS)
        for r in rows:
            writer.writerow([
                r['era'],
                r['start_block'],
                r['end_block']                if r.get('end_block')            is not None else '',
                r.get('start_block_hash')     or '',
                r.get('start_timestamp_unix') if r.get('start_timestamp_unix') is not None else '',
                r.get('start_datetime_utc')   or '',
                r.get('end_timestamp_unix')   if r.get('end_timestamp_unix')   is not None else '',
                r.get('end_datetime_utc')     or '',
            ])


# ── Era binary search ─────────────────────────────────────────────────────────

def find_era_start_block(api, era, chain_head):
    # type: (SubstrateInterface, int, int) -> object
    """
    Binary-search for the first block where Staking.ActiveEra.index == era.
    Returns None if the era is not found on chain (e.g. hasn't started yet).
    """
    print("  Searching era {:>5} ...".format(era), end=" ", flush=True)
    lo, hi, result = 1, chain_head, None

    while lo <= hi:
        mid = (lo + hi) // 2
        mid_era = None
        for _attempt in range(3):
            try:
                bh       = api.get_block_hash(mid)
                era_info = api.query("Staking", "ActiveEra", block_hash=bh)
                mid_era  = era_info.value["index"] if era_info else -1
                break
            except Exception:
                if _attempt < 2:
                    time.sleep(1)
        if mid_era is None:
            lo = mid + 1
            continue

        if mid_era < era:
            lo = mid + 1
        elif mid_era > era:
            hi = mid - 1
        else:
            result = mid
            hi = mid - 1   # keep walking left to find the very first block

    if result is None:
        print("NOT FOUND")
        return None

    # Walk left to confirm the exact first block of this era
    while result > 1:
        prev_era = None
        for _attempt in range(3):
            try:
                prev_bh   = api.get_block_hash(result - 1)
                prev_info = api.query("Staking", "ActiveEra", block_hash=prev_bh)
                prev_era  = prev_info.value["index"] if prev_info else -1
                break
            except Exception:
                if _attempt < 2:
                    time.sleep(1)
        if prev_era is None or prev_era != era:
            break
        result -= 1

    print("  start block {:>12,}".format(result), end=" ", flush=True)

    # Fetch the block hash and UTC timestamp for this era boundary (3 retries)
    start_hash = None
    ts_ms      = None
    for _attempt in range(3):
        try:
            start_hash = api.get_block_hash(result)
            ts_obj     = api.query("Timestamp", "Now", block_hash=start_hash)
            ts_ms      = int(ts_obj.value) if ts_obj and ts_obj.value is not None else None
            print("| {}".format(_ms_to_iso(ts_ms) or 'unknown'))
            break
        except Exception:
            if _attempt < 2:
                time.sleep(1)
    else:
        print()  # newline if all retries exhausted

    return result, start_hash, ts_ms


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    global CSV_FILE  # may be overridden by --output

    parser = argparse.ArgumentParser(
        description="Build and maintain relay-era-reference.csv — era block boundaries, hashes, and timestamps for the Enjin Relaychain.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--endpoint", metavar="URL", default=DEFAULT_ENDPOINT,
                        help="Archive node WebSocket URL (default: {})".format(DEFAULT_ENDPOINT))
    parser.add_argument("--output", metavar="FILE", default=None,
                        help="Output CSV file path (default: {})".format(CSV_FILE))
    parser.add_argument("--ss58-prefix", metavar="N", type=int, default=ENJ_SS58_PREFIX,
                        help="SS58 address prefix for the chain (default: {})".format(ENJ_SS58_PREFIX))
    args = parser.parse_args()

    # Allow --output to override the module-level CSV path
    if args.output:
        CSV_FILE = os.path.abspath(args.output)

    print("\n  Enjin Era Block Finder")
    print("  " + "-" * 50)
    print("  Output   : {}".format(CSV_FILE))
    print("  Endpoint : {}".format(args.endpoint))

    # Decide where to start based on the existing CSV
    existing_rows = read_csv()
    if existing_rows:
        max_existing_era = existing_rows[-1]['era']
        start_from_era   = max_existing_era + 1
        print("  CSV found : {} era(s) recorded, latest era = {}".format(
            len(existing_rows), max_existing_era))
    else:
        max_existing_era = None
        start_from_era   = 1
        print("  No CSV found — will build from era 1")

    # Connect to the archive node
    try:
        api = SubstrateInterface(
            url=args.endpoint,
            ss58_format=args.ss58_prefix,
            type_registry_preset="polkadot",
            ws_options={
                'sslopt': {'cert_reqs': ssl.CERT_NONE},
            },
        )
    except Exception as e:
        print("\n  ERROR: Cannot connect to {}\n  {}".format(args.endpoint, e))
        print("  Hint: Ensure system trusts the endpoint certificate, or run with --endpoint ws://... if available.")
        sys.exit(1)

    chain_head       = api.get_block_number(api.get_chain_head())
    current_era_info = api.query("Staking", "ActiveEra")
    if not current_era_info:
        print("\n  ERROR: Could not determine the current era from chain.")
        sys.exit(1)
    current_era = int(current_era_info.value["index"])

    print("  Chain head: {:,}".format(chain_head))
    print("  Chain era : {}\n".format(current_era))

    needs_backfill = any(
        r.get('start_block_hash') is None or r.get('start_timestamp_unix') is None
        for r in existing_rows
    )
    if max_existing_era is not None and max_existing_era >= current_era and not needs_backfill:
        print("  Already up to date (recorded era {} = current era {}).".format(
            max_existing_era, current_era))
        print("  Nothing to do.\n")
        return
    if max_existing_era is not None and max_existing_era >= current_era and needs_backfill:
        print("  Era data is current (era {}), running backfill for missing fields.".format(
            max_existing_era))

    # ── Backfill pass: fill hash/timestamps for existing rows missing them ─────
    backfill_candidates = [
        r for r in existing_rows
        if r.get('start_block_hash') is None or r.get('start_timestamp_unix') is None
    ]
    if backfill_candidates:
        print("\n  Backfilling {}/{} era(s) missing hash/timestamp data...\n".format(
            len(backfill_candidates), len(existing_rows)))
        bf_changed = False
        for r in backfill_candidates:
            print("  Back-fill era {:>4} (block {:>12,}) ...".format(
                r['era'], r['start_block']), end=' ', flush=True)
            for _attempt in range(3):
                try:
                    h      = api.get_block_hash(r['start_block'])
                    ts_obj = api.query("Timestamp", "Now", block_hash=h)
                    ts_ms  = int(ts_obj.value) if ts_obj and ts_obj.value is not None else None
                    r['start_block_hash']     = h
                    r['start_timestamp_unix'] = ts_ms
                    r['start_datetime_utc']   = _ms_to_iso(ts_ms)
                    print("| {}".format(_ms_to_iso(ts_ms) or 'unknown'))
                    bf_changed = True
                    break
                except Exception:
                    if _attempt < 2:
                        time.sleep(1)
            else:
                print("FAILED (skipped)")
        # Propagate end timestamps forward from each era's known next-era start
        by_era = {r['era']: r for r in existing_rows}
        for r in existing_rows:
            if r.get('end_block') is not None and r.get('end_timestamp_unix') is None:
                nxt = by_era.get(r['era'] + 1)
                if nxt and nxt.get('start_timestamp_unix') is not None:
                    r['end_timestamp_unix'] = nxt['start_timestamp_unix']
                    r['end_datetime_utc']   = nxt['start_datetime_utc']
                    bf_changed = True
        if bf_changed:
            write_csv(existing_rows)
            print("\n  \u2713 Backfill complete.")

    # Incrementally fetch start blocks and persist them as we find them.
    # For each discovered era start we append (if missing) a row with a blank
    # end_block; when we discover the next era's start we back-fill the
    # previous era's end_block immediately and persist the CSV.
    any_change = False
    for era in range(start_from_era, current_era + 2):
        result = find_era_start_block(api, era, chain_head)
        if result is None:
            # likely the current_era + 1 which hasn't started yet
            break

        blk, start_hash, ts_ms = result

        # Check if this era already exists in the CSV
        existing = next((r for r in existing_rows if r['era'] == era), None)
        if existing is None:
            # Append a row for this era with unknown end_block for now
            existing_rows.append({
                'era':                  era,
                'start_block':          blk,
                'end_block':            None,
                'start_block_hash':     start_hash,
                'start_timestamp_unix': ts_ms,
                'start_datetime_utc':   _ms_to_iso(ts_ms),
                'end_timestamp_unix':   None,
                'end_datetime_utc':     None,
            })
            existing_rows = sorted(existing_rows, key=lambda r: r['era'])
            write_csv(existing_rows)
            any_change = True
            print("  Appended era {} start block {:,}".format(era, blk))
        else:
            changed = False
            if existing['start_block'] != blk:
                existing['start_block'] = blk
                changed = True
            # Fill hash/timestamps if missing (e.g. CSV had old schema)
            if start_hash and not existing.get('start_block_hash'):
                existing['start_block_hash'] = start_hash
                changed = True
            if ts_ms is not None and existing.get('start_timestamp_unix') is None:
                existing['start_timestamp_unix'] = ts_ms
                existing['start_datetime_utc']   = _ms_to_iso(ts_ms)
                changed = True
            if changed:
                write_csv(existing_rows)
                any_change = True
                print("  Updated era {} start block to {:,}".format(era, blk))

        # Back-fill previous era's end_block and end timestamps
        prev = era - 1
        if prev >= 1:
            prev_row = next((r for r in existing_rows if r['era'] == prev), None)
            if prev_row:
                prev_changed = False
                if prev_row.get('end_block') is None:
                    prev_row['end_block'] = blk - 1
                    prev_changed = True
                    print("  Back-filled end_block for era {}: {:,}".format(prev, prev_row['end_block']))
                if ts_ms is not None and prev_row.get('end_timestamp_unix') is None:
                    prev_row['end_timestamp_unix'] = ts_ms
                    prev_row['end_datetime_utc']   = _ms_to_iso(ts_ms)
                    prev_changed = True
                if prev_changed:
                    write_csv(existing_rows)
                    any_change = True

    if not any_change and start_from_era <= current_era:
        print("\n  ERROR: Could not resolve any new start blocks or updates from era {}.".format(start_from_era))
        sys.exit(1)

    print("\n  \u2713 Wrote {:,} total era(s) to '{}'.".format(len(existing_rows), CSV_FILE))
    # Report newly added range if anything was appended
    if any_change:
        new_eras = [r['era'] for r in existing_rows if r['era'] >= start_from_era]
        if new_eras:
            print("  Added {} new era(s): {} \u2192 {}".format(
                len(new_eras), new_eras[0], new_eras[-1]))
            if any(r['end_block'] is None for r in existing_rows if r['era'] >= start_from_era):
                last = max(new_eras)
                print("  Note: era {} is still ongoing — end_block will be filled on the next run.".format(last))
    print()


if __name__ == "__main__":
    main()
