#!/usr/bin/env python3
"""
Enjin Staking Rewards Query Script
====================================
Queries an Enjin Indexer GraphQL endpoint to retrieve staking rewards
per pool per era for a given relaychain wallet address.

Usage:
    python staking-rewards.py <address> <start_era> <end_era> [options]

Examples:
    python staking-rewards.py 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY 100 150
    python staking-rewards.py 5GrwvaEF... 100 150 --endpoint https://your-indexer/graphql
    python staking-rewards.py 5GrwvaEF... 100 150 --json > rewards.json

Environment variables:
    INDEXER_ENDPOINT    GraphQL endpoint URL (overrides default)
"""

import argparse
import json
import os
import sys
from decimal import Decimal, getcontext
from typing import Optional

try:
    import requests
except ImportError:
    print("ERROR: 'requests' package not found. Install it with: pip install requests")
    sys.exit(1)

getcontext().prec = 40  # High precision for large bigints

# ── Constants ─────────────────────────────────────────────────────────────────

ENJ_DECIMALS = Decimal(10 ** 18)
DEFAULT_ENDPOINT = os.getenv("INDEXER_ENDPOINT", "http://localhost:4000/graphql")
PAGE_SIZE = 1000

# ── GraphQL Query ─────────────────────────────────────────────────────────────

QUERY = """
query StakingRewards(
    $address: String!
    $startEra: Int!
    $endEra: Int!
    $limit: Int!
    $offset: Int!
) {
    poolMemberRewards(
        where: {
            member: { account: { id_eq: $address } }
            eraIndex_gte: $startEra
            eraIndex_lte: $endEra
        }
        orderBy: eraIndex_ASC
        limit: $limit
        offset: $offset
    ) {
        id
        eraIndex
        rewards
        accumulatedRewards
        points
        pool {
            id
            name
            apy
            rate
            state
        }
        reward {
            id
            apy
            averageApy
            reinvested
            active
            rate
            era {
                index
                startAt
                endAt
                startBlock
            }
        }
    }
}
"""

# ── Formatting Helpers ────────────────────────────────────────────────────────

def to_enj(raw) -> Decimal:
    """Convert a raw bigint value (string or int) to ENJ with 18 decimal precision."""
    return Decimal(str(raw)) / ENJ_DECIMALS


def fmt_enj(raw, decimals: int = 6) -> str:
    """Format a raw bigint as a human-readable ENJ amount."""
    return f"{to_enj(raw):.{decimals}f} ENJ"


def fmt_date(iso_str: Optional[str]) -> str:
    """Shorten an ISO8601 datetime string to YYYY-MM-DD."""
    if not iso_str:
        return "N/A"
    return iso_str[:10]


def fmt_pct(value, decimals: int = 2) -> str:
    if value is None:
        return "N/A"
    return f"{float(value):.{decimals}f}%"


def separator(char: str = "─", width: int = 110) -> str:
    return "  " + char * width


# ── Network ───────────────────────────────────────────────────────────────────

def graphql_request(endpoint: str, variables: dict) -> list:
    """Send a single paginated GraphQL request and return the list of records."""
    payload = {"query": QUERY, "variables": variables}
    try:
        resp = requests.post(
            endpoint,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=60,
        )
        resp.raise_for_status()
    except requests.exceptions.ConnectionError as e:
        print(f"\n  ERROR: Cannot connect to {endpoint}")
        print(f"         {e}")
        print("  Make sure INDEXER_ENDPOINT is set to a reachable GraphQL URL.")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"\n  ERROR: HTTP {resp.status_code} from {endpoint}: {e}")
        sys.exit(1)

    data = resp.json()
    if "errors" in data:
        print(f"\n  ERROR: GraphQL returned errors:")
        for err in data["errors"]:
            print(f"    - {err.get('message', err)}")
        sys.exit(1)

    return data["data"]["poolMemberRewards"]


def fetch_all_rewards(endpoint: str, address: str, start_era: int, end_era: int) -> list:
    """Fetch all pool member reward records, handling pagination automatically."""
    all_rows = []
    offset = 0
    page = 1
    print(f"  Fetching data from indexer...", end="", flush=True)
    while True:
        batch = graphql_request(endpoint, {
            "address": address,
            "startEra": start_era,
            "endEra": end_era,
            "limit": PAGE_SIZE,
            "offset": offset,
        })
        all_rows.extend(batch)
        print(f" page {page} ({len(batch)} rows)", end="", flush=True)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        page += 1

    print(f"\n  Total records fetched: {len(all_rows)}\n")
    return all_rows


# ── Output Rendering ──────────────────────────────────────────────────────────

def render_detail(rows: list, address: str, start_era: int, end_era: int):
    """Print the full per-pool per-era detail table."""

    # Group by pool
    pools: dict[str, dict] = {}
    for row in rows:
        pool_id = row["pool"]["id"]
        if pool_id not in pools:
            pools[pool_id] = {
                "name": row["pool"].get("name") or f"Pool #{pool_id}",
                "apy": row["pool"].get("apy", 0),
                "state": row["pool"].get("state", ""),
                "rows": [],
            }
        pools[pool_id]["rows"].append(row)

    print()
    print(separator("═"))
    print("  STAKING REWARDS — PER POOL PER ERA")
    print(separator("═"))

    summary_pools = []

    for pool_id, pool_data in pools.items():
        pname = pool_data["name"]
        pool_rows = pool_data["rows"]
        pool_apy = pool_data["apy"]
        pool_state = pool_data["state"]
        pool_total_raw = sum(int(r["rewards"]) for r in pool_rows)
        pool_total_acc_raw = int(pool_rows[-1]["accumulatedRewards"]) if pool_rows else 0

        print()
        print(f"  Pool: {pname}  (ID: {pool_id}  |  State: {pool_state}  |  Current APY: {fmt_pct(pool_apy)})")
        print(separator())

        col_w = [7, 14, 14, 20, 24, 24, 10, 11]
        headers = ["Era", "Start Date", "End Date", "sENJ Points", "Reward (ENJ)", "Acc. Reward (ENJ)", "Era APY", "Avg APY"]

        header_str = "  " + "  ".join(h.ljust(col_w[i]) for i, h in enumerate(headers))
        print(header_str)
        print(separator("·"))

        for row in pool_rows:
            era_idx = row.get("eraIndex") or ""
            points_raw = int(row.get("points", 0))
            reward_raw = int(row.get("rewards", 0))
            acc_raw = int(row.get("accumulatedRewards", 0))

            reward_info = row.get("reward") or {}
            era_info = reward_info.get("era") or {}

            start_at = fmt_date(era_info.get("startAt"))
            end_at = fmt_date(era_info.get("endAt"))
            era_apy = fmt_pct(reward_info.get("apy"))
            avg_apy = fmt_pct(reward_info.get("averageApy"))

            points_str = f"{to_enj(points_raw):.4f}"
            reward_str = f"{to_enj(reward_raw):.6f}"
            acc_str = f"{to_enj(acc_raw):.6f}"

            cells = [str(era_idx), start_at, end_at, points_str, reward_str, acc_str, era_apy, avg_apy]
            print("  " + "  ".join(c.ljust(col_w[i]) for i, c in enumerate(cells)))

        print(separator("·"))
        print(f"  Pool subtotal: {fmt_enj(pool_total_raw)}  |  Accumulated (last era): {fmt_enj(pool_total_acc_raw)}")

        summary_pools.append({
            "pool_id": pool_id,
            "pool_name": pname,
            "era_count": len(pool_rows),
            "total_rewards_raw": pool_total_raw,
            "apy": pool_apy,
            "state": pool_state,
        })

    return summary_pools


def render_summary(summary_pools: list, address: str, start_era: int, end_era: int):
    """Print the summary section."""
    grand_total_raw = sum(p["total_rewards_raw"] for p in summary_pools)
    era_range = end_era - start_era + 1

    print()
    print()
    print(separator("═"))
    print("  SUMMARY")
    print(separator("═"))
    print()
    print(f"  Address   :  {address}")
    print(f"  Era Range :  {start_era} → {end_era}  ({era_range} eras requested)")
    print(f"  Pools     :  {len(summary_pools)} pool(s) found with rewards in range")
    print()

    col_w = [38, 10, 8, 12, 26]
    headers = ["Pool Name", "Pool ID", "Eras", "APY", "Total Reward (ENJ)"]
    print("  " + "  ".join(h.ljust(col_w[i]) for i, h in enumerate(headers)))
    print(separator("·"))

    for pool in summary_pools:
        cells = [
            pool["pool_name"][:37],
            pool["pool_id"],
            str(pool["era_count"]),
            fmt_pct(pool["apy"]),
            fmt_enj(pool["total_rewards_raw"]),
        ]
        print("  " + "  ".join(c.ljust(col_w[i]) for i, c in enumerate(cells)))

    print(separator("·"))
    grand_label = "GRAND TOTAL"
    print(f"  {grand_label:<70}  {fmt_enj(grand_total_raw)}")
    print()
    print(separator("═"))
    print()


# ── Entry Point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Query staking rewards per pool per era from the Enjin Indexer GraphQL API.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("address", help="Relaychain wallet address (SS58 format)")
    parser.add_argument("start_era", type=int, help="Start era index (inclusive)")
    parser.add_argument("end_era", type=int, help="End era index (inclusive)")
    parser.add_argument(
        "--endpoint",
        default=DEFAULT_ENDPOINT,
        metavar="URL",
        help=f"GraphQL endpoint URL (default: $INDEXER_ENDPOINT or {DEFAULT_ENDPOINT})",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON instead of formatted table",
    )
    parser.add_argument(
        "--no-summary",
        action="store_true",
        help="Skip the summary section",
    )

    args = parser.parse_args()

    if args.start_era > args.end_era:
        print("ERROR: start_era must be less than or equal to end_era")
        sys.exit(1)

    print()
    print("  ┌─────────────────────────────────────────────────────┐")
    print("  │          Enjin Staking Rewards Query Script         │")
    print("  └─────────────────────────────────────────────────────┘")
    print()
    print(f"  Address  : {args.address}")
    print(f"  Eras     : {args.start_era} → {args.end_era}")
    print(f"  Endpoint : {args.endpoint}")
    print()

    # Fetch
    rows = fetch_all_rewards(args.endpoint, args.address, args.start_era, args.end_era)

    if not rows:
        print("  ⚠  No rewards found for this address in the specified era range.")
        print("     Possible reasons:")
        print("     - The address has never joined a nomination pool")
        print("     - The era range has no indexed reward records yet")
        print("     - The address format may be incorrect")
        print()
        sys.exit(0)

    # JSON output mode
    if args.json:
        print(json.dumps(rows, default=str, indent=2))
        return

    # Render detail + summary
    summary_pools = render_detail(rows, args.address, args.start_era, args.end_era)

    if not args.no_summary:
        render_summary(summary_pools, args.address, args.start_era, args.end_era)


if __name__ == "__main__":
    main()
