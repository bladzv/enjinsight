# Enjin Staking Rewards — Direct RPC Tools

Two tools for computing nomination-pool staking rewards directly from the Enjin Relaychain archive node, with no indexer or database required.

| Tool | File | Description |
|---|---|---|
| CLI script | `scripts/staking-rewards-rpc.py` | Python CLI, outputs a table or JSON |
| Web app | `web/index-rpc.html` | Browser app using Polkadot.js API |

---

## Quick Start

### Python Script

```bash
pip install substrate-interface

python3 scripts/staking-rewards-rpc.py

# JSON output (all prompts still appear; pipe stdout after prompts complete)
python3 scripts/staking-rewards-rpc.py --json > rewards.json

# Custom endpoint
python3 scripts/staking-rewards-rpc.py \
  --endpoint wss://archive.relay.blockchain.enjin.io
```

The script is **fully interactive** — run it with no positional arguments and follow the prompts:

1. **Wallet address** — must start with `en` (Enjin Relaychain SS58 prefix 2135)
2. **Pool scope** — current pools only, or include historic pools (exited pools)
   - Historic option: provide a Subscan CSV export, or download live via Subscan API key
3. **Era range** — era numbers, or YYYY-MM-DD date range if `era-reference.csv` is present

Flags:

| Flag | Description |
|---|---|
| `--endpoint URL` | WebSocket archive node URL (default: `wss://archive.relay.blockchain.enjin.io`) |
| `--json` | Output raw JSON array instead of the human-readable tables |

### era-reference.csv (optional, strongly recommended)

Run `era-reference.py` once to build `era-reference.csv`, then keep it beside `staking-rewards-rpc.py`:

```bash
python3 scripts/era-reference.py
```

When the file is found, `staking-rewards-rpc.py` loads it automatically — all era block boundaries, hashes, and timestamps are pre-cached, skipping the expensive RPC binary-search entirely. Date-range era selection also becomes available.

### Web App

Open `web/index-rpc.html` directly in a browser, or via a local server:

```bash
python3 -m http.server 8080
open http://localhost:8080/web/index-rpc.html
```

Enter the wallet address, era range, and archive node URL, then click **Query Rewards**. The progress console at the bottom shows each RPC call in real time.

---

## How It Works

### 1. Pool Discovery

The standard `NominationPools.PoolMembers` storage does not exist on the Enjin Relaychain — Enjin tracks pool membership via multi-tokens instead.

- `NominationPools.BondedPools` is queried in bulk to get all pool IDs.
- For each pool, `MultiTokens.TokenAccounts(collectionId=1, tokenId=poolId, accountId=address)` is read.
- If `balance > 0`, the address is a current member of that pool.

Historical pool membership (pools the address has since exited) can be added in two ways:
- **Subscan CSV export** — provide a local CSV of nomination-pool extrinsics from Subscan
- **Subscan API** — the script downloads the full extrinsics history automatically using a Subscan API key (or `SUBSCAN_API_KEY` env variable)

Pools with no sENJ balance at a given era's snapshot are automatically skipped during reward computation.

### 2. Era Boundary Block Discovery (Binary Search)

Each era begins at a specific block. To find it:

1. Read `Staking.ActiveEra` at the current chain head to get the current era index.
2. Binary-search across the chain, reading `Staking.ActiveEra.at(blockHash)` at the midpoint.
3. When the midpoint matches the target era, walk left to find the very first block of that era.

Results are cached — each era boundary block is fetched only once across all pools.

**Verified era boundaries:**

| Era | First Block |
|-----|------------|
| 999 | 14,610,352 |
| 1000 | 14,624,752 |
| 1001 | 14,639,152 |
| 1002 | 14,653,551 |

### 3. Snapshot at Era Start

At the first block of each era, two storage values are read using `at(blockHash)`:

- **Member points** — `MultiTokens.TokenAccounts(1, poolId, address)` → `balance`  
  This is the member's sENJ token balance = their proportional share of the pool.

- **Total pool points** — `MultiTokens.Tokens(1, poolId)` → `supply`  
  This is the total sENJ in circulation for this pool.

### 4. Reward Event Scanning

Reward events fire in the blocks *immediately after* the era boundary (i.e., after the first block of era N+1). The tool scans `[era_end_block, era_end_block + 40]`.

Two event types are handled:

**`NominationPools.EraRewardsProcessed`** (newer eras)  
A single event per pool per era. Fields: `pool_id`, `era`, `reinvested`.  
If present, `reinvested` is used directly.

**`NominationPools.RewardPaid`** (legacy eras, including era 999–1001)  
Fires once per nominated validator. Fields: `pool_id`, `era`, `validator_stash`, `reward`, `commission: { beneficiary, amount }`.  
The tool sums `reward + commission.amount` across all matching events.

> **Important:** The `era` field in both event types equals the *actual* era number (no offset needed).

### 5. Reward Formula

```
reward = (member_points × reinvested) / total_pool_points
```

This gives the member's proportional share of the ENJ that was reinvested into the pool during the era.

### APY Estimate

```
era_apy = ((total_points + reinvested) / total_points) ^ ERAS_PER_YEAR) - 1
```

where `ERAS_PER_YEAR = 365`. `total_points` (sENJ supply) is read at the era's **start block** — before that era's rewards are applied — so the per-era fractional gain is `reinvested / total_points`, compounded over 365 eras to give an annual estimate.

---

## Chain-Specific Facts

| Property | Value |
|---|---|
| Archive node | `wss://archive.relay.blockchain.enjin.io` |
| SS58 prefix | 2135 |
| ENJ decimals | 18 |
| sENJ collection ID | 1 |
| Eras per year | 365 |
| `NominationPools.PoolMembers` | **Not present** (Enjin custom) |
| Pool share token | `MultiTokens.TokenAccounts(1, poolId, address)` |
| Pool total supply | `MultiTokens.Tokens(1, poolId).supply` |

---

## Tested Output

Tested with eras 999–1001 on the Enjin Relaychain archive node:

- Address is in 6 pools: **[14, 17, 18, 21, 23, 26]**
- Pool 14 / Era 999: ~0.005908 ENJ (~75.83% APY)
- Pool 14 / Era 1000: ~0.005580 ENJ (~70.42% APY)

---

## Requirements and Limitations

**Python script:**
- Python 3.9+
- `substrate-interface` package: `pip install substrate-interface`

**Web app:**
- Modern browser with ES module support
- `@polkadot/api@14` loaded from CDN (`esm.sh`) — requires internet access

**Both tools:**
- An Enjin Relaychain archive node (the default `wss://archive.relay.blockchain.enjin.io` is publicly available)
- Historical pool exits are supported via Subscan CSV or Subscan API (Python script only)
- Each era query makes ~100 pool-check RPC calls + ~25 binary-search calls per era (skipped with `era-reference.csv`) + ~40 event-scan calls per era per pool — expect 2–10 minutes for a 3-era query across 6 pools
- If the archive node is slow or rate-limited, the binary search and event scan may time out

---

## Related Files

| File | Description |
|---|---|
| `scripts/era-reference.py` | Builds and maintains `era-reference.csv` (era block boundaries, hashes, timestamps) |
| `scripts/staking-rewards.py` | Indexer-based version (faster, requires the GraphQL API) |
| `web/index.html` | Indexer-based web app |
| `STAKING_SCRIPT_DOCS.md` | Docs for the indexer-based tools |
| `STAKING_REWARDS_RESEARCH.md` | Background research and chain discovery notes |
