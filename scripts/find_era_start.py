#!/usr/bin/env python3
"""
Temporary helper: find the start block for a given era using the same
binary-search approach as `era-range-fetch.py`.

Usage:
  python3 scripts/find_era_start_temp.py --era 1006
  python3 scripts/find_era_start_temp.py --era 1006 --endpoint wss://your-node

Requires: pip install substrate-interface
"""
import argparse
import time
import sys

try:
    from substrateinterface import SubstrateInterface
except Exception as e:
    print('Install dependency: pip install substrate-interface')
    raise

DEFAULT_ENDPOINT = 'wss://archive.relay.blockchain.enjin.io'

def find_era_start_block(api, era, chain_head):
    lo, hi, result = 1, chain_head, None
    while lo <= hi:
        mid = (lo + hi) // 2
        mid_era = None
        for _ in range(3):
            try:
                bh = api.get_block_hash(mid)
                era_info = api.query('Staking', 'ActiveEra', block_hash=bh)
                mid_era = era_info.value['index'] if era_info else -1
                break
            except Exception:
                time.sleep(0.5)
        if mid_era is None:
            lo = mid + 1
            continue
        if mid_era < era:
            lo = mid + 1
        elif mid_era > era:
            hi = mid - 1
        else:
            result = mid
            hi = mid - 1

    if result is None:
        return None

    # Walk left to confirm exact first block
    while result > 1:
        prev_era = None
        for _ in range(3):
            try:
                prev_bh = api.get_block_hash(result - 1)
                prev_info = api.query('Staking', 'ActiveEra', block_hash=prev_bh)
                prev_era = prev_info.value['index'] if prev_info else -1
                break
            except Exception:
                time.sleep(0.5)
        if prev_era is None or prev_era != era:
            break
        result -= 1

    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--endpoint', default=DEFAULT_ENDPOINT)
    p.add_argument('--era', type=int, required=True)
    args = p.parse_args()

    api = SubstrateInterface(url=args.endpoint, type_registry_preset='polkadot')
    chain_head = api.get_block_number(api.get_chain_head())
    print(f'chain_head={chain_head}')
    res = find_era_start_block(api, args.era, chain_head)
    if res is None:
        print(f'Era {args.era} not found on chain (or not started yet).')
        sys.exit(2)
    bh = api.get_block_hash(res)
    # Avoid querying historical pallet 'Timestamp' (may be pruned on some nodes).
    # Only print the start block and its hash to match era-range-fetch.py's core result.
    print(f'era {args.era} start_block = {res}\nstart_block_hash = {bh}')


if __name__ == '__main__':
    main()
