#!/usr/bin/env python3
"""
Enjin Staking Rewards — Direct RPC Script
==========================================
Computes staking rewards per pool per era for a given relaychain wallet
address by querying the Enjin Relaychain archive node directly via
Polkadot JSON-RPC. No indexer, no database, no third-party services needed.

Usage:
    python staking-rewards-rpc.py [--endpoint URL] [--json]

Examples:
    python staking-rewards-rpc.py
    python staking-rewards-rpc.py --endpoint wss://archive.relay.blockchain.enjin.io
    python staking-rewards-rpc.py --json > rewards.json

Requirements:
    pip install substrate-interface certifi

Environment variables:
    RPC_ENDPOINT    Archive node WebSocket URL (overrides default)

How it works:
  1. Build the set of pool IDs to query, merged from up to three sources:
       a. NominationPools.BondedPools + MultiTokens.TokenAccounts (current active pools)
       b. --csv FILE: pool IDs parsed from a local Subscan extrinsics CSV export
       c. --subscan-key KEY: pool IDs downloaded live from the Subscan API
     Pool shares are stored as sENJ multi-tokens: collection 1, token ID = pool ID.
     Historical pools (already exited) are included so past rewards are not missed.
  2. Binary-search Staking.ActiveEra across the chain to find each era's first block.
  3. Read MultiTokens.TokenAccounts and MultiTokens.Tokens at each era start block
     to get member points and total pool supply.
  4. Scan the ~40 blocks after each era boundary for NominationPools.RewardPaid
     (or EraRewardsProcessed if present) events and sum the reinvested amounts.
  5. Calculate: reward = (member_points * reinvested) / total_pool_points
"""

import argparse
import ast
import csv as csv_module
import http.client
import json
import os
import re
import ssl
import sys
import time
from datetime import datetime as _dt, timezone as _tz
from typing import Optional, List, Dict, Set

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

# ── Constants ─────────────────────────────────────────────────────────────────

SCALE            = 10 ** 18
ERAS_PER_YEAR    = 365
ENJ_SS58_PREFIX  = 2135
COLLECTION_ID    = 1            # sENJ multi-token collection that tracks pool shares
DEFAULT_ENDPOINT    = os.getenv("RPC_ENDPOINT", "wss://archive.relay.blockchain.enjin.io")
SUBSCAN_HOST        = "enjin.api.subscan.io"
SUBSCAN_RETRY_DELAY = 5
SUBSCAN_API_KEY     = os.getenv("SUBSCAN_API_KEY", "")

# ── SSL context ────────────────────────────────────────────────────────────────
# On macOS (and some Linux setups) Python does not use the system CA store by
# default, causing "CERTIFICATE_VERIFY_FAILED" when connecting to HTTPS/WSS.
# Prefer certifi's CA bundle if available; fall back to the system default.
try:
    import certifi as _certifi
    _SSL_CA_BUNDLE = _certifi.where()
    _SSL_CTX = ssl.create_default_context(cafile=_SSL_CA_BUNDLE)
except ImportError:
    _SSL_CA_BUNDLE = None
    _SSL_CTX = ssl.create_default_context()


def _ws_options(endpoint):
    # type: (str) -> dict
    """
    Return websocket-client options for SubstrateInterface.
    For wss:// endpoints, force certificate verification and, when available,
    provide certifi's CA bundle explicitly.
    """
    opts = {}
    if str(endpoint).lower().startswith("wss://"):
        sslopt = {'cert_reqs': ssl.CERT_REQUIRED}
        if _SSL_CA_BUNDLE:
            sslopt['ca_certs'] = _SSL_CA_BUNDLE
        opts['sslopt'] = sslopt
    return opts

# ── Formatting ────────────────────────────────────────────────────────────────

def to_enj(raw, decimals=6):
    # type: (int, int) -> str
    if raw == 0:
        return "0.000000"
    whole = raw // SCALE
    frac  = str(raw % SCALE).zfill(18)[:decimals]
    return "{:,}.{}".format(whole, frac)


def fmt_apy(apy):
    # type: (float) -> str
    if not isinstance(apy, float) or apy <= 0:
        return "  -    "
    return "{:6.2f}%".format(apy)


# ── Interactive helpers ───────────────────────────────────────────────────────

def _prompt(msg):
    # type: (str) -> str
    """
    Show msg as an interactive prompt.
    Calls sys.exit(0) if the user types 'q', 'quit', 'exit', or hits Ctrl-C/Ctrl-D.
    Returns the stripped input string (may be empty for a bare Enter).
    """
    try:
        val = input(msg).strip()
    except (KeyboardInterrupt, EOFError):
        print()
        print("\n  Exiting.")
        sys.exit(0)
    if val.lower() in ('q', 'quit', 'exit'):
        print("  Exiting.")
        sys.exit(0)
    return val


def _load_era_ref_rows(csv_path):
    # type: (str) -> list
    """Load era-reference.csv rows (era + datetime fields) for date-based era lookup."""
    rows = []
    try:
        with open(csv_path, newline='', encoding='utf-8') as f:
            for row in csv_module.DictReader(f):
                try:
                    rows.append({
                        'era':                int(row['era']),
                        'start_datetime_utc': (row.get('start_datetime_utc') or '').strip(),
                        'end_datetime_utc':   (row.get('end_datetime_utc')   or '').strip(),
                    })
                except (KeyError, ValueError):
                    continue
    except Exception:
        pass
    return sorted(rows, key=lambda r: r['era'])


def _eras_for_date_range(rows, from_str, to_str):
    # type: (list, str, str) -> Optional[tuple]
    """
    Given era-reference rows and two YYYY-MM-DD date strings, return
    (start_era, end_era) covering all eras that overlap the date range,
    or None if no eras match or the dates are invalid.
    """
    try:
        dt_from = _dt.strptime(from_str.strip(), '%Y-%m-%d').replace(tzinfo=_tz.utc)
        dt_to   = _dt.strptime(to_str.strip(),   '%Y-%m-%d').replace(
            hour=23, minute=59, second=59, tzinfo=_tz.utc)
    except ValueError:
        print("  Invalid date format. Please use YYYY-MM-DD.")
        return None
    if dt_from > dt_to:
        print("  Start date must be before or equal to end date.")
        return None
    matching = []
    for r in rows:
        s = r.get('start_datetime_utc', '')
        if not s:
            continue
        try:
            era_start = _dt.strptime(s[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=_tz.utc)
        except ValueError:
            continue
        e = r.get('end_datetime_utc', '')
        era_end = None
        if e:
            try:
                era_end = _dt.strptime(e[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=_tz.utc)
            except ValueError:
                pass
        # Overlap: era starts before range ends AND (era ends after range starts OR is ongoing)
        if era_start <= dt_to and (era_end is None or era_end >= dt_from):
            matching.append(r['era'])
    if not matching:
        return None
    return min(matching), max(matching)


# ── CSV and Subscan pool history ──────────────────────────────────────────────

def extract_pool_ids_from_csv(csv_path):
    # type: (str) -> Set[int]
    """
    Read a Subscan extrinsics CSV and return all pool IDs found in the params column.
    The params column contains a Python-repr list of parameter dicts, e.g.:
      [{'name': 'pool_id', 'type': 'U32', 'type_name': 'PoolId', 'value': 14}, ...]
    """
    pool_ids = set()
    try:
        with open(csv_path, newline='', encoding='utf-8') as f:
            reader = csv_module.DictReader(f)
            for row in reader:
                params_str = (row.get('params') or '').strip()
                if not params_str:
                    continue
                try:
                    params = ast.literal_eval(params_str)
                    if isinstance(params, list):
                        for p in params:
                            if isinstance(p, dict) and p.get('name') == 'pool_id':
                                pool_ids.add(int(p['value']))
                except Exception:
                    # Fallback: regex search if literal_eval fails
                    m = re.search(r"'name':\s*'pool_id'.*?'value':\s*(\d+)", params_str)
                    if m:
                        pool_ids.add(int(m.group(1)))
    except FileNotFoundError:
        print("  ERROR: CSV file not found: {}".format(csv_path))
        sys.exit(1)
    except Exception as e:
        print("  ERROR: Failed to read CSV: {}".format(e))
        sys.exit(1)
    return pool_ids


def _subscan_post(endpoint, payload, headers, max_retries=3):
    # type: (str, dict, dict, int) -> Optional[object]
    """POST to the Subscan API and return the parsed 'data' field, or None on failure."""
    for attempt in range(max_retries):
        conn = None
        try:
            conn = http.client.HTTPSConnection(SUBSCAN_HOST, context=_SSL_CTX)
            conn.request("POST", endpoint, json.dumps(payload), headers)
            resp = conn.getresponse()
            if resp.status == 429:
                print("  [subscan] Rate limited, retrying in {}s...".format(SUBSCAN_RETRY_DELAY))
                time.sleep(SUBSCAN_RETRY_DELAY)
                continue
            if resp.status != 200:
                raise Exception("HTTP {}".format(resp.status))
            data = json.loads(resp.read().decode())
            if data.get('code') != 0:
                raise Exception("API error: {}".format(data.get('message', 'unknown')))
            return data.get('data')
        except Exception as e:
            print("  [subscan] Request failed (attempt {}/{}): {}".format(attempt + 1, max_retries, e))
            if attempt < max_retries - 1:
                time.sleep(SUBSCAN_RETRY_DELAY)
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
    return None


def fetch_pool_ids_from_subscan(address, api_key):
    # type: (str, str) -> Set[int]
    """
    Download all nomination-pool extrinsics for the address from the Subscan API
    and return the complete set of pool IDs the address has ever interacted with.
    """
    headers = {
        'x-api-key':    api_key,
        'Content-Type': 'application/json',
    }
    pool_ids     = set()
    after_id     = 0
    page         = 0
    row_per_page = 100

    while True:
        payload = {
            "row":         row_per_page,
            "signed":      "signed",
            "module_call": [{"module": "nominationpools", "call": ""}],
            "address":     address,
            "page":        page,
        }
        if after_id > 0:
            payload["after_id"] = after_id

        result = _subscan_post("/api/v2/scan/extrinsics", payload, headers)
        if not result or not isinstance(result, dict):
            print("  [subscan] Empty or unexpected response, stopping.")
            break

        records = result.get('extrinsics') or []
        if not records:
            break

        # Enrich each record with its decoded call parameters
        indices = [r['extrinsic_index'] for r in records if 'extrinsic_index' in r]
        if indices:
            params_data = _subscan_post(
                "/api/scan/extrinsic/params",
                {"extrinsic_index": indices},
                headers,
            )
            if isinstance(params_data, list):
                params_by_idx = {
                    item['extrinsic_index']: item.get('params', [])
                    for item in params_data
                    if 'extrinsic_index' in item
                }
                for rec in records:
                    idx = rec.get('extrinsic_index')
                    if idx in params_by_idx:
                        rec['params'] = params_by_idx[idx]

        # Extract pool_id values from call params
        for rec in records:
            for p in (rec.get('params') or []):
                if isinstance(p, dict) and p.get('name') == 'pool_id':
                    try:
                        pool_ids.add(int(p['value']))
                    except (ValueError, TypeError):
                        pass

        print("  [subscan] Page {}: {} extrinsics fetched, pool IDs so far: {}".format(
            page + 1, len(records), sorted(pool_ids)))

        if len(records) < row_per_page:
            break

        if records and 'id' in records[-1]:
            after_id = records[-1]['id']
        else:
            page += 1

        time.sleep(1)

    return pool_ids


# ── Era blocks CSV loader ────────────────────────────────────────────────────

def load_era_blocks_csv(csv_path):
    # type: (str) -> int
    """
    Pre-populate _era_block_cache and _era_hash_cache from a CSV produced by
    era-reference.py.  Columns: era, start_block, end_block[, start_block_hash, ...]
    Skips binary search for any era already in the cache, greatly reducing
    the number of RPC calls needed.
    """
    count = 0
    try:
        with open(csv_path, newline='', encoding='utf-8') as f:
            reader = csv_module.DictReader(f)
            for row in reader:
                try:
                    era         = int(row['era'])
                    start_block = int(row['start_block'])
                    _era_block_cache[era] = start_block
                    # Derive start of era+1 from end_block so the cache covers
                    # both era_start and era_end look-ups used in compute_rewards.
                    eb = row.get('end_block', '').strip()
                    if eb:
                        _era_block_cache[era + 1] = int(eb) + 1
                    # Cache the pre-computed block hash so compute_rewards skips
                    # the get_block_hash(era_start) RPC call entirely.
                    h = row.get('start_block_hash', '').strip()
                    if h:
                        _era_hash_cache[era] = h
                    dt = (row.get('start_datetime_utc') or row.get('start_datetime') or '').strip()
                    if dt:
                        _era_datetime_cache[era] = dt
                    count += 1
                except (KeyError, ValueError):
                    continue
    except FileNotFoundError:
        print("  ERROR: Era blocks CSV not found: {}".format(csv_path))
        sys.exit(1)
    except Exception as e:
        print("  ERROR: Failed to read era blocks CSV: {}".format(e))
        sys.exit(1)
    return count


# ── Pool membership discovery ─────────────────────────────────────────────────

def find_member_pools(api, address, extra_pool_ids=None):
    # type: (SubstrateInterface, str, Optional[Set[int]]) -> List[int]
    """
    Return sorted pool IDs the address is currently in or has historically interacted with.

    Active pools are found by scanning NominationPools.BondedPools and checking
    MultiTokens.TokenAccounts for a non-zero sENJ balance. The Enjin relaychain
    has no PoolMembers storage — shares are tracked as sENJ in MultiTokens
    collection 1 (token ID = pool ID).

    extra_pool_ids, if provided, are merged in so historical pools (already
    exited by the address) are also included. The reward computation will
    naturally skip any era where the member had zero sENJ at that era's start.
    """
    print("  [RPC]  Fetching all pool IDs from NominationPools.BondedPools...")
    pool_entries = list(api.query_map("NominationPools", "BondedPools"))
    all_pool_ids = sorted([int(k.value) for k, _ in pool_entries])
    print("  [RPC]  {} pools found. Checking membership for address...".format(len(all_pool_ids)))

    member_pools = []
    for pool_id in all_pool_ids:
        try:
            ta = api.query("MultiTokens", "TokenAccounts", [COLLECTION_ID, pool_id, address])
            if ta and ta.value:
                bal = int(ta.value.get("balance", 0))
                if bal > 0:
                    member_pools.append(pool_id)
                    print("  [RPC]  Pool {}: current sENJ balance = {}".format(pool_id, to_enj(bal)))
        except Exception:
            continue

    # Merge in historically-known pools (from CSV / Subscan) that are not
    # currently active. The reward computation skips any era where the member
    # had zero sENJ balance at that era's start block.
    if extra_pool_ids:
        for pid in sorted(extra_pool_ids):
            if pid not in member_pools:
                member_pools.append(pid)
                print("  [HISTORICAL]  Pool {}: included from pool history (no current sENJ balance)".format(pid))

    return sorted(member_pools)


# ── Era boundary binary search ────────────────────────────────────────────────

_era_block_cache    = {}  # type: Dict[int, int]
_era_hash_cache     = {}  # type: Dict[int, str]   # era → start_block_hash (from CSV)
_era_datetime_cache = {}  # type: Dict[int, str]   # era → start_datetime_utc (from CSV)


def find_era_start_block(api, era, chain_head):
    # type: (SubstrateInterface, int, int) -> Optional[int]
    """
    Binary-search for the first block where Staking.ActiveEra.index == era.
    Results are cached so each era is only looked up once.
    """
    if era in _era_block_cache:
        return _era_block_cache[era]

    print("  [RPC]  Binary searching for era {} start block (chain head: {:,})...".format(era, chain_head))
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
            hi = mid - 1   # keep searching leftward to find the very first block of this era

    if result is None:
        print("  [warn] Era {} not found on chain.".format(era))
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

    print("  [RPC]  Era {} starts at block {:,}".format(era, result))
    _era_block_cache[era] = result
    return result


# ── Reward event scanning ─────────────────────────────────────────────────────

def find_reinvested(api, pool_id, era, era_end_block):
    # type: (SubstrateInterface, int, int, int) -> int
    """
    Sum the ENJ reinvested into pool_id during era by scanning chain events.

    The events fire in the blocks IMMEDIATELY AFTER the era boundary block:
      - NominationPools.RewardPaid(pool_id, era, validator_stash, reward, commission?)
        fires once per nominated validator; we sum reward + commission.amount.
      - NominationPools.EraRewardsProcessed(pool_id, era, reinvested, ...)
        fires once per pool and takes precedence if present.

    era_end_block = first block of era+1 (i.e. where era transitions).
    Events typically fire in the ~40 blocks immediately after that boundary.
    Note: the 'era' field in both event types equals the actual era number (no offset).
    """
    scan_start = era_end_block         # the boundary block itself
    scan_end   = era_end_block + 40    # scan up to 40 blocks after

    total = 0

    for blk in range(scan_start, scan_end + 1):
        try:
            bh     = api.get_block_hash(blk)
            events = api.get_events(block_hash=bh)
        except Exception:
            continue

        for ev in events:
            try:
                e     = ev.value
                mod   = e.get("event", {}).get("module_id", "")
                meth  = e.get("event", {}).get("event_id", "")
                attrs = e.get("event", {}).get("attributes", {})

                if mod != "NominationPools":
                    continue

                ev_pool = int(attrs.get("pool_id", -1))
                ev_era  = int(attrs.get("era",     -1))

                if ev_pool != pool_id or ev_era != era:
                    continue

                if meth == "EraRewardsProcessed":
                    # Canonical single event — supersedes any RewardPaid sum
                    total = int(attrs.get("reinvested", 0))
                    print("  [RPC]  EraRewardsProcessed at block {:,}: {} ENJ".format(blk, to_enj(total)))
                    return total

                elif meth == "RewardPaid":
                    reward     = int(attrs.get("reward", 0))
                    commission = attrs.get("commission") or {}
                    comm_amt   = int(commission.get("amount", 0)) if isinstance(commission, dict) else 0
                    total += reward + comm_amt

            except Exception:
                continue

    if total > 0:
        print("  [RPC]  RewardPaid (summed, blocks {:,}-{:,}): {} ENJ".format(scan_start, scan_end, to_enj(total)))

    return total


# ── Main computation ──────────────────────────────────────────────────────────

def compute_rewards(api, address, start_era, end_era, extra_pool_ids=None):
    # type: (SubstrateInterface, str, int, int, Optional[Set[int]]) -> List[dict]

    chain_head = api.get_block_number(api.get_chain_head())

    current_era_info = api.query("Staking", "ActiveEra")
    current_era = int(current_era_info.value["index"]) if current_era_info else None
    if end_era is None:
        if current_era is not None:
            end_era = current_era
        else:
            print("  ERROR: Cannot determine current era from chain.")
            return []
    if current_era is not None:
        print("  Current era on chain: {}".format(current_era))
        if end_era > current_era:
            print("  [warn] end_era clamped from {} to {}".format(end_era, current_era))
            end_era = current_era

    # Discover which pools the address is in (current + historical via CSV/Subscan)
    member_pools = find_member_pools(api, address, extra_pool_ids=extra_pool_ids)
    if not member_pools:
        print("\n  Warning: No pool membership found for this address.")
        print("  Try providing pool history via --csv or --subscan-key to include")
        print("  pools the address has already exited.")
        return []

    print("\n  Pool(s) to query: {}".format(member_pools))

    # Pre-fetch era start blocks (need era N and N+1 for each requested era)
    print("\n  Pre-fetching era boundary blocks for eras {}-{}...".format(start_era, end_era + 1))
    for era in range(start_era, end_era + 2):
        find_era_start_block(api, era, chain_head)

    # Per-pool, per-era computation
    results = []
    for pool_id in member_pools:
        pool_accumulated = 0
        for era in range(start_era, end_era + 1):
            era_start = _era_block_cache.get(era)
            era_end   = _era_block_cache.get(era + 1)

            if era_start is None or era_end is None:
                print("  Pool {} / Era {}: missing block boundary, skipping.".format(pool_id, era))
                continue

            block_hash = _era_hash_cache.get(era) or api.get_block_hash(era_start)

            # Member sENJ balance at era start
            try:
                ta = api.query("MultiTokens", "TokenAccounts",
                               [COLLECTION_ID, pool_id, address], block_hash=block_hash)
                member_points = int(ta.value.get("balance", 0)) if (ta and ta.value) else 0
            except Exception:
                member_points = 0

            if member_points == 0:
                print("  Pool {} / Era {}: not a member at era start, skipping.".format(pool_id, era))
                continue

            # Total pool sENJ supply at era start
            try:
                tok = api.query("MultiTokens", "Tokens",
                                [COLLECTION_ID, pool_id], block_hash=block_hash)
                total_points = int(tok.value.get("supply", 0)) if (tok and tok.value) else 0
            except Exception:
                total_points = 0

            if total_points == 0:
                print("  Pool {} / Era {}: pool has 0 total supply, skipping.".format(pool_id, era))
                continue

            # Sum reward events in the blocks after the era boundary
            print("  Pool {} / Era {}: scanning events after block {:,}...".format(pool_id, era, era_end))
            reinvested = find_reinvested(api, pool_id, era, era_end)

            if reinvested == 0:
                print("  Pool {} / Era {}: no reward events found.".format(pool_id, era))
                continue

            # Core formula: reward = (memberPoints x reinvested) / totalPoints
            reward           = (member_points * reinvested) // total_points
            pool_accumulated += reward

            # APY: ((supply_after / supply_before) ^ erasPerYear) - 1
            # total_points is read at era start (before this era's reinvestment),
            # so the per-era gain fraction is reinvested / total_points.
            era_apy = (((total_points + reinvested) / total_points) ** ERAS_PER_YEAR - 1) * 100

            results.append({
                "era":                era,
                "pool_id":            pool_id,
                "member_points":      member_points,
                "total_points":       total_points,
                "reinvested":         reinvested,
                "reward":             reward,
                "accumulated":        pool_accumulated,
                "era_apy":            era_apy,
                "era_start_block":    era_start,
                "era_start_datetime": _era_datetime_cache.get(era, ''),
            })
            print("  Pool {} / Era {}: {} ENJ  (APY ~{:.2f}%)".format(
                pool_id, era, to_enj(reward), era_apy))

    return results


# ── Rendering ─────────────────────────────────────────────────────────────────

def render(rows, address):
    # type: (List[dict], str) -> None
    if not rows:
        print("\n  No rewards found for the given address and era range.")
        return

    pools = {}  # type: Dict[int, List[dict]]
    for r in rows:
        pools.setdefault(r["pool_id"], []).append(r)

    has_dates = any(r.get("era_start_datetime") for r in rows)
    W = 114 if has_dates else 90

    # ── Per-pool detail tables ────────────────────────────────────────────────
    print("\n" + "=" * W)
    print("  RESULTS  |  {}".format(address))
    print("=" * W)

    grand_total = 0
    pool_totals = {}  # type: Dict[int, int]

    for pool_id, pool_rows in sorted(pools.items()):
        pool_total = sum(r["reward"] for r in pool_rows)
        grand_total += pool_total
        pool_totals[pool_id] = pool_total
        avg_apy = sum(r["era_apy"] for r in pool_rows) / len(pool_rows)

        print("\n  Pool {}  |  {} era(s) with rewards  |  avg APY {:.2f}%".format(
            pool_id, len(pool_rows), avg_apy))
        print("  " + "-" * (W - 2))
        if has_dates:
            print("  {:<6}  {:<19}  {:>13}  {:>16}  {:>16}  {:>14}  {:>7}".format(
                "Era", "Date (UTC)", "Start Block", "Member sENJ", "Reinvested ENJ", "Reward ENJ", "APY"))
        else:
            print("  {:<6}  {:>13}  {:>22}  {:>22}  {:>14}  {:>7}".format(
                "Era", "Start Block", "Member sENJ", "Reinvested ENJ", "Reward ENJ", "APY"))
        print("  " + "-" * (W - 2))

        for r in pool_rows:
            if has_dates:
                print("  {:<6}  {:<19}  {:>13,}  {:>16}  {:>16}  {:>14}  {:>7}".format(
                    r["era"],
                    (r.get("era_start_datetime") or "")[:19] or "-",
                    r["era_start_block"],
                    to_enj(r["member_points"]),
                    to_enj(r["reinvested"]),
                    to_enj(r["reward"]),
                    fmt_apy(r["era_apy"]),
                ))
            else:
                print("  {:<6}  {:>13,}  {:>22}  {:>22}  {:>14}  {:>7}".format(
                    r["era"],
                    r["era_start_block"],
                    to_enj(r["member_points"]),
                    to_enj(r["reinvested"]),
                    to_enj(r["reward"]),
                    fmt_apy(r["era_apy"]),
                ))
        print("  " + "-" * (W - 2))
        print("  {:>{}}  {:>14}".format(
            "Pool {} subtotal".format(pool_id), W - 18, to_enj(pool_total)))

    # ── Per-pool aggregated totals ─────────────────────────────────────────────
    print("\n" + "=" * W)
    print("  POOL SUMMARY")
    print("  " + "-" * (W - 2))
    print("  {:<10}  {:>18}  {:>6}  {:>7}".format(
        "Pool ID", "Total Reward (ENJ)", "Eras", "Avg APY"))
    print("  " + "-" * (W - 2))
    for pool_id, pool_rows in sorted(pools.items()):
        avg_apy = sum(r["era_apy"] for r in pool_rows) / len(pool_rows)
        print("  {:<10}  {:>18}  {:>6}  {:>7}".format(
            pool_id, to_enj(pool_totals[pool_id]), len(pool_rows), fmt_apy(avg_apy)))
    print("  " + "-" * (W - 2))
    print("  {:<10}  {:>18}  {:>6}".format("GRAND TOTAL", to_enj(grand_total), len(rows)))

    # ── Combined all-records table ─────────────────────────────────────────────
    all_sorted = sorted(rows, key=lambda r: (r["era"], r["pool_id"]))
    print("\n" + "=" * W)
    print("  COMBINED LOG  ({} record(s), sorted by era)".format(len(rows)))
    print("  " + "-" * (W - 2))
    if has_dates:
        print("  {:<6}  {:<8}  {:<19}  {:>13}  {:>14}  {:>7}".format(
            "Era", "Pool", "Date (UTC)", "Start Block", "Reward ENJ", "APY"))
    else:
        print("  {:<6}  {:<8}  {:>13}  {:>14}  {:>7}".format(
            "Era", "Pool", "Start Block", "Reward ENJ", "APY"))
    print("  " + "-" * (W - 2))
    for r in all_sorted:
        if has_dates:
            print("  {:<6}  {:<8}  {:<19}  {:>13,}  {:>14}  {:>7}".format(
                r["era"], r["pool_id"],
                (r.get("era_start_datetime") or "")[:19] or "-",
                r["era_start_block"],
                to_enj(r["reward"]),
                fmt_apy(r["era_apy"]),
            ))
        else:
            print("  {:<6}  {:<8}  {:>13,}  {:>14}  {:>7}".format(
                r["era"], r["pool_id"],
                r["era_start_block"],
                to_enj(r["reward"]),
                fmt_apy(r["era_apy"]),
            ))
    print("  " + "-" * (W - 2))
    print("  {:>{}}  {:>14} ENJ".format("GRAND TOTAL", W - 18, to_enj(grand_total)))
    print("=" * W + "\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    try:
        _run()
    except KeyboardInterrupt:
        print("\n\n  Interrupted. Exiting.\n")
        sys.exit(0)


def _run():
    parser = argparse.ArgumentParser(
        description="Compute Enjin staking rewards directly from the archive node (no indexer).",
        epilog=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--endpoint", metavar="URL", default=DEFAULT_ENDPOINT,
                        help="Archive node WebSocket URL (default: {})".format(DEFAULT_ENDPOINT))
    parser.add_argument("--json", action="store_true",
                        help="Output raw JSON instead of the human-readable table.")
    args = parser.parse_args()

    print("\n  Enjin Staking Rewards — Direct RPC")
    print("  " + "=" * 50)
    print("  Type 'q' or Ctrl-C at any prompt to exit.\n")

    # ── Step 1: Wallet address ─────────────────────────────────────────────────
    while True:
        address = _prompt("  Wallet address (must start with 'en'): ")
        if not address:
            print("  Address cannot be empty.")
            continue
        if not address.startswith('en'):
            print("  Invalid: Enjin Relaychain addresses start with 'en'.")
            continue
        break

    # ── Step 2: Pool scope ─────────────────────────────────────────────────────
    print()
    print("  Which pool data do you want to query?")
    print("    [1] Current pools only  (wallet is currently staked)")
    print("    [2] Include historic    (also pools already exited in the past)")
    while True:
        scope = _prompt("  Select [1/2]: ")
        if scope in ('1', '2'):
            break
        print("  Please enter 1 or 2.")

    extra_pool_ids = set()  # type: Set[int]

    if scope == '2':
        # ── Step 2B: Historical source ─────────────────────────────────────────
        print()
        print("  How would you like to load historic pool data?")
        print("    [1] Upload a Subscan extrinsics CSV export")
        print("    [2] Download directly from the Subscan API")
        while True:
            hsrc = _prompt("  Select [1/2]: ")
            if hsrc in ('1', '2'):
                break
            print("  Please enter 1 or 2.")

        if hsrc == '1':
            # 2B.i — upload Subscan CSV
            path = _prompt("  Path to Subscan CSV file: ")
            if path:
                ids = extract_pool_ids_from_csv(path)
                extra_pool_ids.update(ids)
                if ids:
                    print("  Pool IDs found in CSV: {}".format(sorted(ids)))
                else:
                    print("  No pool IDs found in '{}'.".format(path))
            else:
                print("  No path provided — historic data will not be included.")
        else:
            # 2B.ii — download via Subscan API
            api_key = (_prompt("  Subscan API key [or set SUBSCAN_API_KEY env]: ") or '').strip()
            if not api_key:
                api_key = SUBSCAN_API_KEY
            if not api_key:
                print("  No API key provided — historic data will not be included.")
            else:
                print("  Downloading pool history from Subscan API...")
                ids = fetch_pool_ids_from_subscan(address, api_key)
                extra_pool_ids.update(ids)
                if ids:
                    print("  Pool IDs found via Subscan: {}".format(sorted(ids)))
                else:
                    print("  No pool IDs found via Subscan.")

    # ── Step 3 & 4: Locate era-reference.csv ──────────────────────────────────
    script_dir = os.path.dirname(os.path.abspath(__file__))
    _candidates = [
        os.path.join(script_dir, 'era-reference.csv'),
        os.path.join(script_dir, '..', 'era-reference.csv'),
        os.path.join(os.getcwd(), 'era-reference.csv'),
    ]
    era_ref_path = None
    for _p in _candidates:
        _norm = os.path.normpath(_p)
        if os.path.isfile(_norm):
            era_ref_path = _norm
            break

    era_ref_rows = []  # full rows for date-based lookup
    if era_ref_path:
        print("\n  Found era-reference.csv: {}".format(era_ref_path))
        n = load_era_blocks_csv(era_ref_path)
        era_ref_rows = _load_era_ref_rows(era_ref_path)
        print("  Loaded {} era(s) — era block boundaries pre-populated, no RPC binary search needed.".format(n))
    else:
        print("\n  era-reference.csv not found.")
        print("  Era block boundaries will be fetched via RPC binary search (slower).")
        print("  Tip: run era-reference.py first to generate era-reference.csv.\n")

    # ── Step 5: Era range selection ────────────────────────────────────────────
    start_era = None
    end_era   = None  # None → resolved to current era after connecting

    has_dates = bool(era_ref_rows) and any(r.get('start_datetime_utc') for r in era_ref_rows)

    if has_dates:
        print()
        print("  How do you want to specify the era range?")
        print("    [1] Enter era numbers")
        print("    [2] Enter date range (UTC)")
        while True:
            rtype = _prompt("  Select [1/2]: ")
            if rtype in ('1', '2'):
                break
            print("  Please enter 1 or 2.")

        if rtype == '2':
            while True:
                from_str = _prompt("  Start date (YYYY-MM-DD): ")
                to_str   = _prompt("  End date   (YYYY-MM-DD): ")
                result   = _eras_for_date_range(era_ref_rows, from_str, to_str)
                if result is None:
                    print("  No eras found for that date range. Try different dates.")
                    continue
                start_era, end_era = result
                print("  Date range maps to era {} \u2014 {}.".format(start_era, end_era))
                break

    if start_era is None:
        print()
        while True:
            try:
                start_era = int(_prompt("  Start era: "))
                break
            except (ValueError, TypeError):
                print("  Must be an integer.")
        while True:
            try:
                val = (_prompt("  End era   [Enter = current chain era]: ") or '').strip()
                if not val:
                    end_era = None
                    break
                end_era = int(val)
                break
            except (ValueError, TypeError):
                print("  Must be an integer.")
        if end_era is not None and start_era > end_era:
            print("  ERROR: start_era must be <= end_era.")
            sys.exit(1)

    # ── Configuration summary ──────────────────────────────────────────────────
    print()
    print("  " + "=" * 50)
    print("  Address    : {}".format(address))
    print("  Era range  : {} \u2192 {}".format(start_era, end_era or 'current'))
    print("  Endpoint   : {}".format(args.endpoint))
    print("  Era ref CSV: {}".format(era_ref_path or 'not found \u2014 using RPC'))
    if extra_pool_ids:
        print("  Historic pools: {}".format(sorted(extra_pool_ids)))
    print()

    # ── Step 6: Connect ────────────────────────────────────────────────────────
    try:
        api = SubstrateInterface(
            url=args.endpoint,
            ss58_format=ENJ_SS58_PREFIX,
            type_registry_preset="polkadot",
            ws_options=_ws_options(args.endpoint),
        )
    except Exception as e:
        print("  ERROR: Cannot connect to {}\n  {}".format(args.endpoint, e))
        if "CERTIFICATE_VERIFY_FAILED" in str(e):
            print("  Hint: TLS certificate verification failed.")
            if _SSL_CA_BUNDLE:
                print("  CA bundle: {}".format(_SSL_CA_BUNDLE))
            else:
                print("  Install certifi and retry: pip install certifi")
                print("  (macOS Python.org users may also need to run Install Certificates.command)")
        sys.exit(1)

    # ── Step 7: Compute and output ─────────────────────────────────────────────
    rows = compute_rewards(
        api, address, start_era, end_era,
        extra_pool_ids=extra_pool_ids or None,
    )

    if args.json:
        print(json.dumps(rows, default=str, indent=2))
    else:
        render(rows, address)


if __name__ == "__main__":
    main()
