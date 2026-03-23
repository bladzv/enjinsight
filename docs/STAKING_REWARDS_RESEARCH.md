# Staking Rewards per Era per Nomination Pool — Research Notes

> This document explains how the indexer calculates staking rewards that a wallet receives per era per nomination pool. It is written for beginners. Use this as a guide when building a script that accepts a relaychain address and returns reward breakdowns.

---

## Table of Contents

1. [Core Concepts (Plain English)](#1-core-concepts-plain-english)
2. [How an Era Reward Is Recorded](#2-how-an-era-reward-is-recorded)
3. [Key Formulas](#3-key-formulas)
4. [Database Models You Need](#4-database-models-you-need)
5. [How to Query Rewards for a Wallet Address](#5-how-to-query-rewards-for-a-wallet-address)
6. [The Full Data Flow (Step-by-Step)](#6-the-full-data-flow-step-by-step)
7. [Important ID Formats](#7-important-id-formats)
8. [Relevant Source Files](#8-relevant-source-files)
9. [How the Indexer Connects to the Blockchain](#9-how-the-indexer-connects-to-the-blockchain)
10. [How to Build the Script (Step-by-Step Guide)](#10-how-to-build-the-script-step-by-step-guide)

---

## 1. Core Concepts (Plain English)

### What is an Era?
A **era** is a fixed time period on the blockchain (e.g., roughly 24 hours on Enjin). Staking rewards are distributed once per era. Think of it like a "pay period".

### What is a Nomination Pool?
A **nomination pool** lets regular users pool their tokens together to stake collectively. Each pool nominates one or more validators. When validators earn rewards, the pool gets a cut, and that cut is then split among pool members proportionally.

### What are "points" / sENJ tokens?
When you bond tokens into a pool, you receive **pool tokens** (called sENJ, stored in token collection ID `1`). Your balance of these tokens represents your **share** of the pool. More sENJ = bigger share.

- `points` = total sENJ token supply for a pool = total shares across all members
- `memberPoints` = your personal sENJ balance = your share

### What is the Pool Rate?
The **rate** is a number that tells you how much 1 sENJ point is worth in ENJ at any given moment. It goes up over time as the pool earns rewards.

```
rate = (active_staked_balance * 10^18) / total_pool_points
```

The `10^18` is just a scaling factor (like "18 decimal places") so we can work with whole numbers instead of decimals.

---

## 2. How an Era Reward Is Recorded

Every era, one of two blockchain events fires:

### Event A: `NominationPools.EraRewardsProcessed` (current, new path)
> This is the modern event fired once per pool per era.

It carries:
- `poolId` — which pool
- `era` — which era index
- `reinvested` — total ENJ reinvested into the pool this era (rewards + commission combined)
- `bonus` — any early-bird bonus paid
- `commission` — if any commission is taken, the amount and beneficiary

### Event B: `NominationPools.RewardPaid` (legacy path, v1060 and older)
> This fires multiple times per era, once per validator the pool nominated.

It carries:
- `poolId`, `era`, `validatorStash`, `reward` (+ optionally `commission`)
- The rewards are **accumulated** across all validator payouts until the era is complete.

---

## 3. Key Formulas

### Pool Rate
```
rate = (pool.balance.active * 10^18) / pool.points
```
- `pool.balance.active` = total ENJ actively staked by the pool (in the staking ledger)
- `pool.points` = total sENJ supply (sum of all member balances)

> The rate grows each era as rewards are reinvested. This is the core of how rewards compound.

---

### Total Pool Points (re-derived)
```
totalPoolPoints = (pool.balance.active * 10^18) / pool.rate
```
This is mathematically equivalent to `pool.points`, but re-computed from the current state to ensure accuracy during reward distribution.

---

### Member Era Reward  ← **This is the key formula for your script**
```
memberReward = (memberPoints * eraReward.reinvested) / totalPoolPoints
```
- `memberPoints` = member's sENJ token balance at the time of the era
- `eraReward.reinvested` = total ENJ rewards reinvested into the pool this era
- `totalPoolPoints` = total sENJ supply at the time (see formula above)

**In plain English:** Your share of what was reinvested = (your points / all points) × total reinvested.

---

### Member Accumulated Rewards
```
member.accumulatedRewards = member.accumulatedRewards + memberReward
```
Each era, the member's running total grows by their era reward.

---

### Single-Era APY (first era ever for a pool)
```
apy = (rate / 10^18)^erasPerYear - 1, × 100
```

### Single-Era APY (subsequent eras)
```
newBalance    = eraReward.reinvested + previousEra.active
previousBalance = previousEra.active
apy = (newBalance / previousBalance)^erasPerYear - 1, × 100
```
> `erasPerYear` is a config value (the number of eras in a year on the specific chain).

### Average/Smoothed APY
The indexer keeps up to **30 recent era rewards** and computes a **rolling average** of up to **15 non-outlier eras**:
- An era is considered an "outlier" if its APY differs by ≥ 50% from the pool's current smoothed APY.
- The final `averageApy` = mean of the non-outlier eras.

---

## 4. Database Models You Need

For your script, these are the models (database tables) you'll be querying:

### `Account`
| Field | Type | Notes |
|---|---|---|
| `id` | `string` | The relaychain address (SS58) |

---

### `PoolMember`
Represents a user's membership in a specific pool.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `"{poolId}-{accountId}"` |
| `pool` | `NominationPool` | The pool they are in |
| `account` | `Account` | The member's address |
| `bonded` | `bigint` | ENJ they bonded |
| `accumulatedRewards` | `bigint` | Running total of all rewards earned |
| `isActive` | `boolean` | Whether they are currently active |

---

### `PoolMemberRewards`
One record per (member × era). This is where per-era per-pool rewards live.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `"{poolId}-{accountId}-{eraIndex}"` |
| `eraIndex` | `number` | The era number |
| `pool` | `NominationPool` | Which pool |
| `member` | `PoolMember` | Which member |
| `reward` | `EraReward` | The pool-level era reward record |
| `points` | `bigint` | Member's sENJ balance at that era |
| `rewards` | `bigint` | ENJ earned **this era** by this member |
| `accumulatedRewards` | `bigint` | Running total up to and including this era |

> **This is the main table your script needs.** One row = one wallet's reward for one era in one pool.

---

### `EraReward`
One record per (pool × era). Stores the pool-level summary for each era.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `"{poolId}-{eraIndex}"` |
| `pool` | `NominationPool` | Which pool |
| `era` | `Era` | Which era |
| `rate` | `bigint` | Pool rate at this era |
| `active` | `bigint` | Total active staked at this era |
| `reinvested` | `bigint` | Total ENJ reinvested this era (distributed to members) |
| `apy` | `number` | Single-era APY % |
| `averageApy` | `number` | Smoothed rolling APY % |
| `bonus` | `bigint` | Any early-bird bonus |
| `commission` | `CommissionPayment` | Commission taken (if any) |

---

### `NominationPool`
| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Pool ID (as string, e.g. `"1"`) |
| `name` | `string` | Pool name |
| `rate` | `bigint` | Current rate (fixed-point 10^18) |
| `apy` | `number` | Smoothed APY % |
| `points` | `bigint` | Total sENJ supply |
| `state` | `PoolState` | `Open`, `Blocked`, `Destroying`, `Destroyed` |

---

### `Era`
| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Era index as string |
| `index` | `number` | Era number |
| `startAt` | `Date` | When the era started |
| `endAt` | `Date` | When the era ended (null if still active) |

---

## 5. How to Query Rewards for a Wallet Address

Here is the logical approach for your script:

### Step 1 — Find the wallet's pool memberships
```sql
SELECT pm.*
FROM pool_member pm
JOIN account a ON a.id = pm.account_id
WHERE a.id = '<relaychain_address>'
```
> This gives you all pools the wallet has ever been in (or is currently in).

---

### Step 2 — Get per-era rewards for each membership
```sql
SELECT
    pmr.era_index,
    pmr.rewards,
    pmr.accumulated_rewards,
    pmr.points,
    er.reinvested        AS pool_total_reinvested,
    er.apy               AS era_apy,
    er.average_apy,
    e.start_at,
    e.end_at,
    np.name              AS pool_name,
    np.id                AS pool_id
FROM pool_member_rewards pmr
JOIN pool_member pm    ON pm.id = pmr.member_id
JOIN era_reward er     ON er.id = pmr.reward_id
JOIN era e             ON e.id = er.era_id
JOIN nomination_pool np ON np.id = pmr.pool_id
WHERE pm.account_id = '<relaychain_address>'
  AND e.end_at IS NOT NULL       -- only completed eras
ORDER BY e.index ASC
```

This returns **one row per era per pool** for the wallet, containing:
- How many points (sENJ) the wallet had
- How much ENJ they earned that era (`rewards`)
- Their running total (`accumulated_rewards`)
- The era's APY
- When the era happened

---

### Step 3 — Optional: Group by era (across all pools)
If the wallet is in multiple pools, group to see total rewards per era:
```sql
SELECT
    e.index              AS era_index,
    e.start_at,
    e.end_at,
    SUM(pmr.rewards)     AS total_rewards_across_pools,
    JSON_AGG(JSON_BUILD_OBJECT(
        'pool', np.name,
        'poolId', np.id,
        'rewards', pmr.rewards,
        'points', pmr.points
    )) AS breakdown_by_pool
FROM pool_member_rewards pmr
JOIN pool_member pm    ON pm.id = pmr.member_id
JOIN era_reward er     ON er.id = pmr.reward_id
JOIN era e             ON e.id = er.era_id
JOIN nomination_pool np ON np.id = pmr.pool_id
WHERE pm.account_id = '<relaychain_address>'
  AND e.end_at IS NOT NULL
GROUP BY e.index, e.start_at, e.end_at
ORDER BY e.index ASC
```

---

## 6. The Full Data Flow (Step-by-Step)

Here is a simplified walkthrough of what happens each era:

```
1. An era ends on-chain.
   → Staking.EraPaid event fires
   → era.endAt and era.endBlock are saved in the DB

2. The pool receives its portion of the era's validator rewards.
   → NominationPools.EraRewardsProcessed event fires (one per pool)
   → eraReward.reinvested = total ENJ the pool will reinvest (grow members' stake)

3. The indexer processes the event:
   a. Updates the pool's state:
      - pool.balance.active  = total ENJ staked on-chain
      - pool.points          = total sENJ token supply
      - pool.rate            = (active * 10^18) / points   ← grows each era
   
   b. Creates an EraReward record:
      - id = "{poolId}-{eraIndex}"
      - reinvested = data.reinvested
      - rate = pool.rate  (snapshot)
      - apy = computed APY for this era
   
   c. For EACH member of the pool:
      - Gets their sENJ balance (memberPoints)
      - Computes: memberReward = (memberPoints * reinvested) / totalPoolPoints
      - Saves a PoolMemberRewards record:
        - id = "{poolId}-{accountId}-{eraIndex}"
        - rewards = memberReward
        - accumulatedRewards += memberReward
```

---

## 7. Important ID Formats

| Entity | ID Format | Example |
|---|---|---|
| `NominationPool` | `"{poolId}"` | `"3"` |
| `EraReward` | `"{poolId}-{eraIndex}"` | `"3-142"` |
| `PoolMember` | `"{poolId}-{accountId}"` | `"3-5GrwvaEF..."` |
| `PoolMemberRewards` | `"{poolId}-{accountId}-{eraIndex}"` | `"3-5GrwvaEF...-142"` |
| `Era` | `"{eraIndex}"` | `"142"` |
| `Account` | The SS58 address itself | `"5GrwvaEF..."` |

> **Note:** The legacy path (`RewardPaid` event, pre-v1060) adds `+1` to the era index when storing.  
> i.e. `eraIndex stored = eventData.era + 1`. The modern path (`EraRewardsProcessed`) uses `eventData.era` directly.

---

## 8. Relevant Source Files

| File | What It Does |
|---|---|
| [src/pallet/nomination-pools/processors/era-rewards-processed.ts](src/pallet/nomination-pools/processors/era-rewards-processed.ts) | **Main reward calculation** — processes `EraRewardsProcessed` event, creates `EraReward` and all `PoolMemberRewards` records |
| [src/pallet/nomination-pools/processors/reward-paid.ts](src/pallet/nomination-pools/processors/reward-paid.ts) | **Legacy reward path** — handles old `RewardPaid` event (pre-v1060), same formulas |
| [src/pallet/nomination-pools/processors/pool.ts](src/pallet/nomination-pools/processors/pool.ts) | `updatePool()` — refresh pool rate, balance, APY; `computeEraApy()` — rolling average APY |
| [src/model/generated/poolMemberRewards.model.ts](src/model/generated/poolMemberRewards.model.ts) | DB model for per-era per-member rewards |
| [src/model/generated/eraReward.model.ts](src/model/generated/eraReward.model.ts) | DB model for per-era pool-level reward |
| [src/model/generated/nominationPool.model.ts](src/model/generated/nominationPool.model.ts) | DB model for nomination pool |
| [src/model/generated/poolMember.model.ts](src/model/generated/poolMember.model.ts) | DB model for pool membership |
| [src/server-extension/account-staking-summary.ts](src/server-extension/account-staking-summary.ts) | Existing GraphQL resolver returning per-era reward history for accounts (great reference!) |
| [src/worker/jobs/nomination-pools/compute-pool-member-rewards.ts](src/worker/jobs/nomination-pools/compute-pool-member-rewards.ts) | Background job that recomputes member rewards (same formula, good reference) |
| [src/pallet/nomination-pools/events/types/era-rewards-processed.ts](src/pallet/nomination-pools/events/types/era-rewards-processed.ts) | TypeScript type for the on-chain event |

---

## 9. How the Indexer Connects to the Blockchain

This section explains exactly how the indexer gets live and historical data from the chain — so you can replicate the same approach in your standalone script.

---

### Two separate connections

The indexer uses **two separate systems** to access blockchain data:

| System | Purpose | Library |
|---|---|---|
| **Subsquid processor** | Streams historical block events in bulk (archive mode) | `@subsquid/substrate-processor` |
| **Polkadot.js RPC** | Makes direct live storage queries at a specific block hash | `@polkadot/api` |

For your script, **you only need the Polkadot.js RPC connection** — no Subsquid needed.

---

### The RPC singleton (`src/util/rpc.ts`)

The indexer has a singleton class called `Rpc` that wraps a Polkadot.js `ApiPromise`:

```typescript
import { ApiPromise, WsProvider } from '@polkadot/api'

const api = await ApiPromise.create({
    provider: new WsProvider('wss://rpc.relay.blockchain.enjin.io', 5000),
    // custom type overrides for Enjin chain
    types: {
        FrameSystemAccountInfo: {
            nonce: 'u32', consumers: 'u32', providers: 'u32', sufficients: 'u32',
            data: 'PalletBalancesAccountData',
        },
        PalletBalancesAccountData: {
            free: 'u128', reserved: 'u128', frozen: 'u128', flags: 'u128',
        },
    },
})
```

- `WsProvider` opens a WebSocket connection to an RPC node.
- The second argument to `WsProvider` (e.g. `5000`) is the auto-reconnect interval in milliseconds.
- `ApiPromise.create()` returns once the chain types are resolved and connection is ready.

---

### Querying at a specific block (historical data)

The most important technique the indexer uses is **querying storage at a specific block hash**. This lets you ask "what were the token balances at block #1234567?" rather than just "what are the balances right now?"

Here's the exact pattern from `compute-pool-member-rewards.ts`:

```typescript
// Step 1: Get the block hash for a block number
const blockHash = await api.rpc.chain.getBlockHash(blockNumber)

// Step 2: Query storage at that block hash
const entries = await api.query.multiTokens.tokenAccounts.entriesAt(
    blockHash,
    1n,          // collectionId = 1 (sENJ tokens are in collection 1)
    BigInt(poolId)
)

// Step 3: Parse the results
for (const [key, value] of entries) {
    const [, , accountId] = key.args
    const tokenAccount = value.toJSON() as { balance: string } | null
    if (tokenAccount && accountId) {
        const balance = BigInt(tokenAccount.balance || 0)
        // accountId here is a raw public key — encode it to SS58 format:
        const address = encodeAddress(decodeAddress(accountId.toString()), 2135)
        // 2135 = Enjin Relay Chain SS58 prefix
    }
}
```

> **Why `era.startBlock`?** The indexer queries balances at `era.startBlock` (the first block of an era). This is the snapshot of "who holds how many pool tokens at the start of the era", which is then used to determine each member's share of the reward.

---

### Chain endpoints used

From `src/util/config.ts` (environment variables):

| Variable | Default Value | Description |
|---|---|---|
| `CHAIN_ENDPOINT` | `wss://archive.matrix.blockchain.enjin.io` | The matrixchain (default) |
| `CHAIN_PREFIX` | `1110` | SS58 address prefix for matrixchain |
| `ERAS_PER_YEAR` | `365` | Used in APY calculations |

For the **relaychain** (where staking/nomination pools live), use:
- `wss://rpc.relay.blockchain.enjin.io` (Enjin Relay Chain)
- SS58 prefix: `2135`

---

### SS58 Address Encoding

Polkadot-based chains use **SS58 encoding** — the same public key looks different on different chains depending on the prefix.

```typescript
import { encodeAddress, decodeAddress } from '@polkadot/util-crypto'

// Convert any SS58 address (any prefix) to the Enjin Relay Chain format
const relayAddress = encodeAddress(decodeAddress(anyAddress), 2135)

// Or to decode a raw key from on-chain storage back to SS58:
const address = encodeAddress(rawPublicKeyBytes, 2135)
```

The indexer also imports `decode` from `@subsquid/ss58` to convert between address formats when looking up `PoolMember` records in its own database (since DB uses raw byte keys as IDs in some places).

---

## 10. How to Build the Script (Step-by-Step Guide)

This section walks you through exactly how to create a standalone Node.js/TypeScript script that takes a relaychain address and outputs staking rewards per era per pool.

There are **two approaches** — choose based on what you have access to:

---

### Approach A: Query the Indexer Database Directly (Recommended)

If you have access to the PostgreSQL database that the indexer writes to, this is the simplest approach. All the calculations have already been done — just query the results.

#### Prerequisites
- Node.js 18+
- Access to the indexer's PostgreSQL database
- Packages: `pg` (or any Postgres client)

#### The Query

```typescript
import { Client } from 'pg'

const client = new Client({
    connectionString: process.env.DB_URL, // e.g. postgresql://user:pass@localhost:5432/indexer
})

await client.connect()

const address = '5GrwvaEF...' // ← the relaychain address

const result = await client.query(`
    SELECT
        pmr.era_index,
        pmr.rewards::text                   AS rewards_raw,           -- ENJ earned this era (18 decimals)
        pmr.accumulated_rewards::text        AS accumulated_raw,
        pmr.points::text                     AS sENJ_points,
        er.reinvested::text                  AS pool_reinvested,
        er.apy                               AS era_apy,
        er.average_apy,
        e.start_at,
        e.end_at,
        np.name                              AS pool_name,
        np.id                                AS pool_id
    FROM pool_member_rewards pmr
    JOIN pool_member pm     ON pm.id = pmr.member_id
    JOIN era_reward er      ON er.id = pmr.reward_id
    JOIN era e              ON e.id = er.era_id
    JOIN nomination_pool np ON np.id = pmr.pool_id
    WHERE pm.account_id = $1
      AND e.end_at IS NOT NULL
    ORDER BY e.index ASC
`, [address])

for (const row of result.rows) {
    // Convert raw bigint (18 decimals) to human-readable ENJ
    const rewardsENJ = Number(BigInt(row.rewards_raw)) / 1e18

    console.log(`Era ${row.era_index} | Pool: ${row.pool_name} | Reward: ${rewardsENJ.toFixed(6)} ENJ | APY: ${row.era_apy.toFixed(2)}%`)
}

await client.end()
```

> **Note on decimals:** All `bigint` values in the DB use **18 decimal places** (like ENJ's native precision). Divide by `10^18` to get human-readable ENJ amounts.

---

### Approach B: Compute from Scratch via RPC (No Database Required)

If you don't have the indexer database, you can reproduce the calculation directly from the blockchain. This is more work but is standalone.

#### Prerequisites
- Node.js 18+
- Packages: `@polkadot/api`, `@polkadot/util-crypto`

#### Step 1 — Connect to the chain

```typescript
import { ApiPromise, WsProvider } from '@polkadot/api'

const api = await ApiPromise.create({
    provider: new WsProvider('wss://rpc.relay.blockchain.enjin.io'),
})
```

#### Step 2 — Find which pools a wallet is in

```typescript
import { encodeAddress, decodeAddress } from '@polkadot/util-crypto'

const address = '5GrwvaEF...'  // Your SS58 address (any prefix works after decoding)

// nominationPools.poolMembers maps accountId → pool membership info
const memberInfo = await api.query.nominationPools.poolMembers(address)
console.log(memberInfo.toHuman())
// Returns: { poolId, points, rewardPoolTotalEarnings, unbondingEras }
```

This tells you which pool the address belongs to and their `points` (sENJ share).

#### Step 3 — Get the era range you want

```typescript
// Get current era
const currentEra = await api.query.staking.currentEra()
const currentEraIndex = currentEra.unwrap().toNumber()

// Loop over a range, e.g. last 30 eras:
for (let era = currentEraIndex - 30; era <= currentEraIndex; era++) {
    // Process each era...
}
```

#### Step 4 — Get pool's active staked amount for each era

The pool stakes through its **stash account**. The stash account address is derived deterministically from the pool ID:

```typescript
import { bnToU8a, hexToU8a, stringToU8a, u8aConcat, u8aToHex, BN } from '@polkadot/util'

function getPoolStashAddress(poolId: number): string {
    const MOD_PREFIX = stringToU8a('modl')
    const PALLET_ID = hexToU8a('0x656e6a696e706f6f') // 'enjinpoo' in hex — get from chain constants
    const EMPTY = new Uint8Array(15)

    const accountBytes = u8aConcat(
        MOD_PREFIX,
        PALLET_ID,
        new Uint8Array([1]),                           // index 1 = stash account
        bnToU8a(new BN(poolId), { bitLength: 32, isLe: true }),
        EMPTY
    )
    return u8aToHex(accountBytes)
}
```

> **Tip:** The pallet ID is a chain constant. In the indexer it's fetched with `constants.nominationPools.palletId.enjinV100.get(block)`. You can also read it with `api.consts.nominationPools.palletId.toHex()`.

Then get the staking ledger (active staked amount) for the pool's stash account:

```typescript
const stashAddress = getPoolStashAddress(poolId)
const ledger = await api.query.staking.ledger(stashAddress)
const activeStake = ledger.unwrap().active.toBigInt()
```

#### Step 5 — Get sENJ token balances at the era's start block

This is how the indexer knows each member's share. The sENJ tokens live in collection ID `1`, token ID = pool ID.

```typescript
// Get the block hash at the era's start block
// (You'll need to know the start block — store it or look it up from staking.erasStartSessionIndex)
const blockHash = await api.rpc.chain.getBlockHash(eraStartBlock)

// Get ALL token account entries for this pool's sENJ token, at that block
const entries = await api.query.multiTokens.tokenAccounts.entriesAt(
    blockHash,
    1n,             // collectionId = 1
    BigInt(poolId)
)

const memberBalances: Record<string, bigint> = {}
for (const [key, value] of entries) {
    const [, , accountId] = key.args
    const tokenAccount = value.toJSON() as { balance: string } | null
    if (tokenAccount) {
        const ssAddress = encodeAddress(decodeAddress(accountId.toString()), 2135)
        memberBalances[ssAddress] = BigInt(tokenAccount.balance || 0)
    }
}
```

#### Step 6 — Calculate member rewards

This is the **core formula** (identical to what the indexer does):

```typescript
// You need the total reinvested amount for the era.
// This comes from the NominationPools.EraRewardsProcessed event for that era.
// If querying live, you can scan block events. If using the indexer DB, just read era_reward.reinvested.

const totalPoolPoints = (activeStake * 10n ** 18n) / poolRate

const memberPoints = memberBalances[address] ?? 0n
const memberReward = (memberPoints * eraReinvested) / totalPoolPoints

// Convert to human-readable ENJ:
const rewardENJ = Number(memberReward) / 1e18
console.log(`Era ${eraIndex} | Pool ${poolId} | Reward: ${rewardENJ.toFixed(6)} ENJ`)
```

Where:
- `poolRate` = `(activeStake * 10^18n) / totalPoolPoints` — you can compute this or read from the indexer DB
- `eraReinvested` = total ENJ reinvested by the pool this era (from `EraRewardsProcessed` event or indexer DB)

---

### Which approach should you use?

| | Approach A (DB query) | Approach B (RPC) |
|---|---|---|
| **Requires** | Indexer DB access | RPC node access (public or private) |
| **Speed** | Instant (single SQL query) | Slow (one RPC call per era per pool) |
| **Historical data** | ✅ All indexed history | Limited to what's on-chain (may be pruned) |
| **Complexity** | Very simple | Moderate |
| **Recommended for** | Building dashboards, reports | Verifying / standalone tools |

For a quick script, **Approach A is strongly recommended** since all the hard work has already been done by the indexer.

---

## TL;DR for Your Script

To get staking rewards per era per nomination pool for an address:

1. **Look up `PoolMember` records** where `account.id = <your_address>`
2. **Join to `PoolMemberRewards`** — one row per era per pool
3. **The `rewards` field** on `PoolMemberRewards` is the ENJ earned that era
4. **The `accumulated_rewards` field** is a running total since the member joined
5. **Join to `Era`** to get timestamps (filter by `end_at IS NOT NULL` for completed eras)
6. **Join to `NominationPool`** if you want pool names

The core math the indexer uses to produce the `rewards` value:
```
memberReward = (memberSENJBalance * totalPoolReinvestedThisEra) / totalPoolSENJSupply
```
