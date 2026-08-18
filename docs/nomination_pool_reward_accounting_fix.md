# Nomination-Pool Staking Reward Accounting: The Bug, The Fix, and How Rewards Are Computed Now

**Subject:** Enjin Blockchain indexer — `pallet-nomination-pools` reward accounting
**Ticket:** NFTIO-3918
**Affected consumers:** Enjin Wallet, NFT.io (both read pool reward data from the indexer's GraphQL API)
**Status as of 2026-08-18:** fix is merged to `master` but **not yet in a tagged release** (see [Release and Deployment Status](#12-release-and-deployment-status))

---

## Table of Contents

1. [TL;DR](#1-tldr)
2. [Background: what a nomination pool actually is](#2-background-what-a-nomination-pool-actually-is)
3. [How it used to work (before runtime v1060)](#3-how-it-used-to-work-before-runtime-v1060)
4. [What runtime v1060 changed](#4-what-runtime-v1060-changed)
5. [The bug](#5-the-bug)
6. [Blast radius: what users actually saw](#6-blast-radius-what-users-actually-saw)
7. [The fix](#7-the-fix)
8. [How rewards are computed now, end to end](#8-how-rewards-are-computed-now-end-to-end)
9. [Repairing the historical data](#9-repairing-the-historical-data)
10. [Bonus-cycle deprecation (a related cleanup)](#10-bonus-cycle-deprecation-a-related-cleanup)
11. [Verification](#11-verification)
12. [Release and deployment status](#12-release-and-deployment-status)
13. [Open questions](#13-open-questions)
14. [File reference](#14-file-reference)
15. [Glossary](#15-glossary)

---

## 1. TL;DR

The indexer added the operator's commission to the reward amount when it should have
**subtracted** it.

On-chain, the `RewardPaid` event reports the **gross** reward paid into a pool's reward account —
the figure *before* the pool operator's commission is taken out. The commission is then
transferred away, and only the remainder is re-staked (compounded) into the pool. The indexer,
however, computed:

```
reinvested = reward + commission     ← WRONG
```

instead of:

```
reinvested = reward − commission     ← CORRECT
```

Adding instead of subtracting means the result is off by **two times the commission**. For a
pool charging 7% commission, that inflates every per-era reward figure by a factor of
`1.07 / 0.93 ≈ 1.1506` — roughly **+15%**.

Because each member's reward was calculated as their share of that inflated `reinvested` number,
every member's per-era reward *and* their lifetime `accumulatedRewards` total inherited the same
~15% overstatement. Those are exactly the fields Enjin Wallet and NFT.io display as "staking
rewards", which is why historical reward amounts looked too high in both products.

The bug was introduced on **2025-10-30** as a side effect of adapting the indexer to runtime
v1060, and existed for roughly **9 months**.

The fix does two things:

1. Subtracts commission instead of adding it (`netReinvested`).
2. Changes how each member's share is derived — from "a slice of the reinvested pot" to "the
   movement in the pool's on-chain exchange rate multiplied by the member's points". The second
   formula is anchored directly to on-chain state, so it agrees with Subscan and with the
   member's actual balance growth.

A batched, idempotent backfill job recomputes all affected historical rows from on-chain-truth
columns already stored in the database, so no archival RPC replay is needed.

---

## 2. Background: what a nomination pool actually is

If you already know Substrate staking, skip to [§3](#3-how-it-used-to-work-before-runtime-v1060).
Otherwise, this section gives you everything you need.

### 2.1 Staking, briefly

On Enjin Blockchain (a Substrate chain), token holders can **stake** ENJ to help secure the
network and earn rewards. Staking directly requires picking validators, meeting a minimum stake,
and managing the position yourself.

### 2.2 Pools solve the "I have a small bag" problem

A **nomination pool** lets many people combine their ENJ into one large staked position. The pool
picks the validators; members just deposit. Enjin's implementation lives in the relaychain's
`pallet-nomination-pools`.

Each pool has three separate on-chain accounts, derived deterministically from the pool ID
(`createAccount(block, poolId, index)` in `src/pallet/nomination-pools/processors/pool.ts`):

| Index | Account | Purpose |
|-------|---------|---------|
| 1 | **bonded** | Holds the actively staked ENJ. This is the account that earns. |
| 2 | **reward** | Temporary landing zone for incoming validator payouts. |
| 3 | **bonus** | Legacy bonus mechanism (removed in v1060 — see [§10](#10-bonus-cycle-deprecation-a-related-cleanup)). |

### 2.3 Points, not balances

When you join a pool you do not get "shares of ENJ" — you get **points**. Points are an ERC-1155
style token tracked in Enjin's `MultiTokens` pallet: collection `1`, token ID = the pool ID. Your
points balance never changes on its own.

What changes is the **rate**: how much ENJ one point is worth.

```
rate = (bonded account's active stake) × 1e18 ÷ (total points in existence)
```

This is computed in `src/pallet/nomination-pools/processors/pool.ts:62`:

```ts
if (poolPoints && poolPoints.supply > 0n && activeStake) {
    pool.rate = (activeStake.active * 1000_000_000_000_000_000n) / pool.points
}
```

The `1e18` is fixed-point scaling — Substrate has no floating-point arithmetic, so a rate of
"1.05 ENJ per point" is stored as the integer `1_050_000_000_000_000_000`. Every pool starts at
`rate = 1e18` exactly (1 point = 1 ENJ) when it is created.

Your ENJ value at any moment is:

```
your ENJ = your points × rate ÷ 1e18
```

### 2.4 Rewards compound; they are not paid out

This is the single most important concept for understanding both the bug and the fix.

Pool rewards are **not** sent to members' wallets. Instead they are added to the pool's bonded
account via `bond_extra`. The point supply stays the same, but the bonded stake grows — so
`rate` goes up, and every member's ENJ value goes up proportionally, automatically.

So "your reward for era N" is not a transfer you can look up. It is a *derived* quantity:

```
your reward for era N = your points × (rate_after_era_N − rate_before_era_N) ÷ 1e18
```

That difference in rate is what the indexer stores as **`changeInRate`**. Keep this formula in
mind — the fix makes it the authoritative definition.

### 2.5 Commission

Pool operators may charge a **commission**: a percentage of incoming rewards that they keep as
payment for running the pool. Commission is skimmed off the top *before* anything is re-staked.
It never compounds for members.

### 2.6 Eras

Substrate divides time into **eras** (~24h on Enjin). Validator rewards are calculated and paid
per era. So pool accounting is naturally per-era, and the indexer stores one `EraReward` row per
`(pool, era)` pair.

### 2.7 The money flow, in order

Here is the actual on-chain sequence for one era, per validator the pool nominated
(`pallet-nomination-pools::do_payout_rewards`):

```
   ┌─────────────────────────────────────────────────────────────────┐
   │ 1. Validator payout lands in the pool's REWARD account.         │
   │    The chain emits: RewardPaid { poolId, era, reward, ... }      │
   │    ► `reward` is the GROSS amount. Commission NOT yet deducted.  │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ 2. claim_commission() transfers `commission` OUT of the reward   │
   │    account to the operator's beneficiary address.               │
   │    ► This ENJ leaves the pool. It never compounds.              │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ 3. The remainder (reward − commission) is transferred to the     │
   │    BONDED account and staked via bond_extra().                  │
   │    ► ONLY THIS AMOUNT compounds into `rate`.                    │
   └─────────────────────────────────────────────────────────────────┘
```

The amount that actually benefits members is step 3: **`reward − commission`**.

---

## 3. How it used to work (before runtime v1060)

Before v1060 the chain did the arithmetic for the indexer. It emitted one summary event per pool
per era, `EraRewardsProcessed`, whose payload included an explicit `reinvested` field
(`src/pallet/nomination-pools/events/types/era-rewards-processed.ts`):

```ts
export type EraRewardsProcessed = {
    poolId: number
    era: number
    commission?: CommissionPayment
    bonus: bigint
    reinvested: bigint          // ← authoritative, straight from the chain
    bonusCycleEnded?: boolean
}
```

The indexer simply copied it (`src/pallet/nomination-pools/processors/era-rewards-processed.ts`):

```ts
existReward.reinvested = data.reinvested
```

There was nothing to get wrong. The chain had already netted out commission.

---

## 4. What runtime v1060 changed

Runtime v1060 (indexer support added 2025-10-30 in `e1d6607a`,
*"[NFTIO-3339] indexer update 1060 and matrix1030"*) restructured pool reward events:

| | Before v1060 | v1060 and later |
|---|---|---|
| Event | `EraRewardsProcessed` | `RewardPaid` |
| Granularity | **one per pool per era** | **one per validator per pool per era** |
| Carries `reinvested`? | **Yes** — chain-computed | **No** |
| Carries `commission`? | Yes | Yes (newly added on this event) |
| Carries `bonus`? | Yes | **No** — removed |

The `RewardPaid` payload after v1060
(`src/pallet/nomination-pools/events/types/reward-paid.ts`):

```ts
export type RewardPaid = {
    poolId: number
    era: number
    validatorStash: AccountId32
    reward: bigint                    // GROSS — before commission
    bonus?: bigint                    // Removed on v1060
    commission?: CommissionPayment    // Added on v1060
}
```

Two consequences the indexer had to handle:

1. **`reinvested` now has to be derived.** The chain no longer tells you. You must compute it
   from `reward` and `commission`.
2. **Multiple events per era.** A pool nominating five validators receives up to five
   `RewardPaid` events for the same era, each with its own `reward` and `commission`. The
   handler must *accumulate* into a single `EraReward` row rather than overwrite it.

Point 2 was handled correctly. Point 1 was not.

---

## 5. The bug

### 5.1 The offending line

In `src/pallet/nomination-pools/processors/reward-paid.ts`, the pre-fix code read:

```ts
// Accumulating into an existing EraReward row (2nd..Nth validator of the era):
existReward.reinvested += eventData.reward + (newCommission?.amount ?? 0n)

// Creating a fresh EraReward row (1st validator of the era):
reinvested: eventData.reward + (eventData.commission?.amount ?? 0n),
```

And the same mistake in the worker that recomputes eras in bulk,
`src/worker/jobs/nomination-pools/compute-era-rewards.ts`:

```ts
accumulatedRewards += eventData.reward + (eventData.commission?.amount ?? 0n)
```

### 5.2 Why it is wrong

Compare against the money flow in [§2.7](#27-the-money-flow-in-order):

- `reward` is the gross amount that entered the reward account.
- `commission` is then taken **out** of that same amount.
- Therefore what remains to compound is `reward − commission`.

Adding the commission is wrong in two independent ways *simultaneously*, which is why the error
is `2 × commission` rather than `1 × commission`:

| | |
|---|---|
| Error #1 | Failing to subtract the commission that genuinely left the pool → too high by `1 × commission` |
| Error #2 | Adding the commission on top as if it were extra income → too high by another `1 × commission` |
| **Total** | **too high by `2 × commission`** |

A plausible origin: whoever wrote the v1060 handler assumed `RewardPaid.reward` was the *net*
figure (post-commission) and that adding commission back would reconstruct the gross total.
It was already gross, so the addition double-counted.

### 5.3 The size of the error

Let `c` be the commission rate (e.g. `0.07` for 7%) and `R` the gross reward.

```
correct = R − cR = R(1 − c)
buggy   = R + cR = R(1 + c)

buggy / correct = (1 + c) / (1 − c)
```

| Commission rate | Overstatement factor | Overstatement |
|---|---|---|
| 1% | 1.0202 | +2.0% |
| 3% | 1.0619 | +6.2% |
| 5% | 1.1053 | +10.5% |
| **7%** | **1.1505** | **+15.1%** |
| 10% | 1.2222 | +22.2% |
| 15% | 1.3529 | +35.3% |

Note this is **not** a flat error. It scales with each pool's commission rate, so different pools
were wrong by different amounts, and a pool that changed its commission over time was wrong by
different amounts in different eras. That is why the discrepancy was hard to spot as a simple
constant offset.

### 5.4 Worked example: pool 98, era 1126

These are the real on-chain figures used in the regression test
(`tests/reward-math.test.ts`), in Planck (1 ENJ = 1e18 Planck):

```
reward       = 201_003_300_000_000_000_000   =  201.0033 ENJ   (gross)
commission   =  14_077_200_000_000_000_000   =   14.0772 ENJ   (≈ 7.0035%)
changeInRate =         532_539_618_873_000
poolPoints   = 351_008.796350609579401932    points
```

Three ways to compute the era's reinvested amount:

```
CORRECT   reward − commission  = 201.0033 − 14.0772 =  186.9261 ENJ
BUGGY     reward + commission  = 201.0033 + 14.0772 =  215.0805 ENJ

difference = 215.0805 − 186.9261 = 28.1544 ENJ = 2 × 14.0772  ✓ exactly 2× commission

CROSS-CHECK from on-chain rate movement:
  poolPoints × changeInRate ÷ 1e18
  = 351_008.796350609579401932 × 0.000532539618873
  = 186.9261 ENJ                                    ✓ matches the CORRECT figure
```

That cross-check is the crucial piece of evidence. The rate movement is pure on-chain state — it
is derived from the bonded account's actual active stake and the actual point supply, with no
assumption about commission semantics. It independently confirms that `186.9261` is what really
compounded, and therefore that `reward − commission` is the right formula.

The overstatement factor here: `215.0805 / 186.9261 = 1.1506`, i.e. **+15.06%**.

### 5.5 How the error propagated to individual members

The per-member calculation, pre-fix, appeared in three places
(`reward-paid.ts`, `era-rewards-processed.ts`, `compute-pool-member-rewards.ts`):

```ts
const totalPoolPoints = (pool.balance.active * 10n ** 18n) / pool.rate
const eraRewards = (points * reward.reinvested) / totalPoolPoints
const newAccumulated = (member.accumulatedRewards || 0n) + eraRewards - previousReward
```

The formula itself is arithmetically reasonable — it distributes `reinvested` pro-rata by points.
But it is only as good as its input. With `reinvested` inflated ~15%, every member's `eraRewards`
was inflated ~15%, and because `accumulatedRewards` is a running sum of those values, the
lifetime total was inflated ~15% too.

There is also a subtle redundancy worth noting. Substituting the definition of `rate`:

```
totalPoolPoints = active × 1e18 ÷ rate
                = active × 1e18 ÷ (active × 1e18 ÷ points)
                = points
```

So `totalPoolPoints` was just an expensive, round-trip-through-division way of recovering the
pool's total point supply. The fix removes it entirely.

---

## 6. Blast radius: what users actually saw

### 6.1 Database columns that held wrong values

| Table | Column | Nature of error |
|---|---|---|
| `era_reward` | `reinvested` | inflated by `2 × commission` per era |
| `era_reward` | `apy`, `average_apy` | derived from `reinvested`, therefore overstated |
| `pool_member_rewards` | `rewards` | inflated ~proportionally |
| `pool_member_rewards` | `accumulated_rewards` | running sum of the above — inflated |
| `pool_member` | `accumulated_rewards` | lifetime total — inflated |
| `nomination_pool` | `apy`, `historical_apy` | overstated |

### 6.2 GraphQL fields, and therefore the UI

Enjin Wallet and NFT.io read `accumulatedRewards`, `reinvested`, `changeInRate`, and `bonus`.
Of those:

- `accumulatedRewards` — **was wrong** (inflated)
- `reinvested` — **was wrong** (inflated)
- `changeInRate` — **was always correct** (computed from on-chain rate, never touched the bug)
- `bonus` — see [§10](#10-bonus-cycle-deprecation-a-related-cleanup)

### 6.3 Important: displayed balances were never wrong

This is worth stating clearly, because it bounds the severity.

A member's **current staked balance** is computed as `points × rate ÷ 1e18`, where both `points`
and `rate` come straight from chain storage. The bug never touched that path. Balances shown in
Enjin Wallet and NFT.io were correct throughout.

What was wrong was the **reward history and lifetime reward totals** — the "you have earned X
ENJ" figures. So a user comparing their reward history against their balance growth would find
the reward history ~15% too high, and a user comparing against Subscan would find Subscan lower.
No ENJ was created, lost, or misdirected; only the reporting was wrong.

Also unaffected: on-chain state itself, commission payouts to operators (those were correct on
chain and recorded correctly), and `nomination_pool.accumulated_commission`.

---

## 7. The fix

### 7.1 A single source of truth

The fix introduces `src/pallet/nomination-pools/processors/reward-math.ts`, a small module that
is now the only place this arithmetic exists. Previously the same formulas were duplicated
inline across five files, which is precisely how the inconsistency survived so long.

```ts
/**
 * Reward accounting for nomination pools.
 *
 * On-chain semantics (Enjin relaychain `pallet-nomination-pools`, `do_payout_rewards`):
 *   - `RewardPaid.reward` is the GROSS amount added to the pool's reward account from the
 *     validator payout, captured BEFORE commission is deducted.
 *   - `claim_commission()` then transfers `commission` OUT of the reward account.
 *   - Only the remainder (`reward - commission`) is transferred to the bonded account and
 *     staked via `bond_extra`, i.e. only the net amount compounds into the pool rate.
 *
 * Therefore the amount that actually reinvests/compounds is `reward - commission`, NOT
 * `reward + commission`. Historically the indexer added commission, overstating every
 * per-era `reinvested` and every member reward by `2 * commission` (~1.07/0.93 ≈ +15% at a
 * 7% commission). See NFTIO reward-accounting fix.
 */

const RATE_PRECISION = 10n ** 18n

/**
 * Net amount reinvested into the pool for a single `RewardPaid` event.
 * This is what compounds into the pool rate: gross reward minus the operator commission.
 */
export function netReinvested(reward: bigint, commission: bigint): bigint {
    const net = reward - commission
    // Guard against pathological data (commission should never exceed the reward it is
    // carved out of); never contribute a negative amount to reinvested.
    return net > 0n ? net : 0n
}

/**
 * Per-member reward for an era, derived from the on-chain rate movement.
 *
 * `changeInRate` is `rate_now - rate_prev` (rate is scaled by 1e18). A member holding
 * `points` gains `points * changeInRate / 1e18` in value over the era. This is exactly the
 * member's real value growth and is consistent with what Subscan reports, because both read
 * the same on-chain rate. It also equals `points * reinvested / totalPoolPoints` once
 * `reinvested` is the net (post-commission) figure, since
 * `reinvested ≈ changeInRate * totalPoolPoints / 1e18`.
 */
export function memberEraReward(points: bigint, changeInRate: bigint): bigint {
    const reward = (points * changeInRate) / RATE_PRECISION
    return reward > 0n ? reward : 0n
}
```

Both functions clamp at zero. That is defensive, not cosmetic: a negative `reinvested` or a
negative member reward would silently corrupt the running `accumulatedRewards` sums, and
`changeInRate` genuinely can go negative (a validator slash reduces the bonded stake, which
lowers `rate`). Clamping means a slash era contributes `0` rewards rather than a negative
"reward", which matches how rewards are reported elsewhere.

### 7.2 Change #1 — subtract, don't add

```diff
- existReward.reinvested += eventData.reward + (newCommission?.amount ?? 0n)
+ existReward.reinvested += netReinvested(eventData.reward, newCommission?.amount ?? 0n)
```

### 7.3 Change #2 — re-base member rewards on the on-chain rate

This is the more interesting half of the fix.

```diff
- const totalPoolPoints = (pool.balance.active * 10n ** 18n) / pool.rate
- const eraRewards = (points * reward.reinvested) / totalPoolPoints
+ const eraRewards = memberEraReward(points, reward.changeInRate)
```

The old formula derived member rewards **from the indexer's own `reinvested` figure** — so any
error in `reinvested` propagated straight through. The new formula derives them **from the pool's
on-chain exchange-rate movement**, which is independent of how the indexer interprets commission.

Three reasons this is better:

1. **It is the definition, not an approximation.** From [§2.4](#24-rewards-compound-they-are-not-paid-out),
   a member's gain over an era literally *is* `points × Δrate ÷ 1e18`. The new code computes the
   thing being asked about rather than a proxy for it.
2. **It matches Subscan and the member's real balance growth.** Both read the same on-chain rate,
   so the numbers reconcile.
3. **It is robust.** Even if commission semantics change again in a future runtime, member
   rewards stay correct, because rate movement reflects whatever actually got bonded.

The two formulas are mathematically consistent once `reinvested` is correct, since
`reinvested ≈ changeInRate × totalPoolPoints ÷ 1e18`. The pool-98 example in
[§5.4](#54-worked-example-pool-98-era-1126) demonstrates exactly this: both routes give
`186.9261 ENJ`.

### 7.4 Every call site that changed

| File | What changed |
|---|---|
| `src/pallet/nomination-pools/processors/reward-math.ts` | **New.** `netReinvested` + `memberEraReward`. |
| `src/pallet/nomination-pools/processors/reward-paid.ts` | Live v1060+ handler. Uses `netReinvested` on both the create-new and accumulate-into-existing paths; uses `memberEraReward` for members. |
| `src/pallet/nomination-pools/processors/era-rewards-processed.ts` | Historical pre-v1060 handler. Keeps the chain-supplied `reinvested`, but switches member rewards to `memberEraReward` so resyncs are consistent. |
| `src/worker/jobs/nomination-pools/compute-era-rewards.ts` | Bulk era recompute worker. Uses `netReinvested`. |
| `src/worker/jobs/nomination-pools/compute-pool-member-rewards.ts` | Bulk member recompute worker. Uses `memberEraReward`. |
| `src/worker/jobs/nomination-pools/backfill-pool-member-rewards.ts` | **New.** Repairs historical rows in SQL. See [§9](#9-repairing-the-historical-data). |
| `src/queue/constants.ts`, `src/queue/queue-utils.ts`, `src/worker/processors/nomination_pools.processor.ts` | Register and dispatch the new backfill job. |
| `src/pallet/nomination-pools/processors/created.ts`, `pool-mutated.ts`, `schema.graphql`, `db/migrations/1784714541132-Data.js` | Bonus-cycle cleanup. See [§10](#10-bonus-cycle-deprecation-a-related-cleanup). |
| `tests/reward-math.test.ts`, `package.json`, `.github/workflows/tests.yml`, `tsconfig.json`, `eslint.config.mjs` | Regression test plus CI wiring. |

Note that `era-rewards-processed.ts` handles an event that no longer fires — it was removed in
v1060. It still matters because a full database resync replays the entire chain from genesis,
including the pre-v1060 period. Keeping both paths consistent means a resync reproduces the same
numbers as incremental indexing.

---

## 8. How rewards are computed now, end to end

### 8.1 The pipeline

When a `RewardPaid` event arrives, `rewardPaid()` in
`src/pallet/nomination-pools/processors/reward-paid.ts` runs these steps in order:

```
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ STEP 0 — Decode and gate                                                     │
 │   eventData = mappings.nominationPools.events.rewardPaid(item)                │
 │   eraIndex  = eventData.era + 1        ← rewards for era N are recorded as    │
 │                                          era N+1, when they materialise       │
 │   if (!nominationPools.rewardPaid.v1060.is(item))                             │
 │       → store the raw event only; skip reward accounting (older shape)        │
 └──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ STEP 1 — Refresh the pool from CHAIN STORAGE:  updatePool()                   │
 │   points      ← MultiTokens.Tokens(1, poolId).supply                          │
 │   active      ← Staking.Ledger(bonded account).active                         │
 │   rate        ← active × 1e18 ÷ points          ← recomputed, never inferred  │
 │   balance     ← free balances of the 3 pool accounts                          │
 │   (bails out early if the pool is being destroyed)                            │
 └──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ STEP 2 — Accumulate into EraReward:  getReward()                              │
 │   reinvested += netReinvested(reward, commission)   ← THE FIX                 │
 │   commission  = running sum across all validators this era                    │
 │   rate        = pool.rate (snapshot at this block)                            │
 │   (accumulates because a pool gets one event per nominated validator)          │
 └──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ STEP 3 — Compute the rate movement:  updatePoolApy()                          │
 │   fetch the 30 most recent prior EraRewards for this pool                     │
 │   changeInRate = pool.rate − previousEraReward.rate                           │
 │                  (or pool.rate − 1e18 for a pool's very first era)            │
 │   apy / averageApy computed from the balance change                            │
 │   pool.accumulatedCommission += commission                                     │
 └──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ STEP 4 — Per-member rewards:  calculateMemberRewards()                        │
 │   for each member:                                                            │
 │       points      ← MultiTokens.TokenAccounts(1, poolId, account).balance      │
 │       eraRewards  = memberEraReward(points, changeInRate)   ← THE FIX          │
 │       accumulated = member.accumulatedRewards + eraRewards − previousReward    │
 │       bonded      = points × rate ÷ 1e18                                      │
 │   → writes PoolMemberRewards rows + updates PoolMember totals                  │
 └──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ STEP 5 — Persist + notify                                                     │
 │   save EraReward first (PoolMemberRewards FK depends on it),                   │
 │   then pool, members, member-reward rows; emit an SNS event                    │
 └──────────────────────────────────────────────────────────────────────────────┘
```

Ordering matters: **Step 3 must run before Step 4**, because Step 4 reads `reward.changeInRate`,
which Step 3 sets. Under the old formula Step 4 depended on `reinvested` instead, so the ordering
constraint was different — a good thing to be aware of when editing this file.

### 8.2 The formulas, collected

```
rate           = active_stake × 1e18 ÷ total_points                  (from chain storage)
changeInRate   = rate_this_era − rate_previous_era                   (1e18 baseline for era 1)
reinvested     = Σ over validators of max(reward − commission, 0)    ← netReinvested
member reward  = max(points × changeInRate ÷ 1e18, 0)                ← memberEraReward
member bonded  = points × rate ÷ 1e18
accumulated    = previous accumulated + member reward − previousReward
```

### 8.3 Why `previousReward` is subtracted

A pool that nominates five validators receives five `RewardPaid` events for the same era. Each
one re-runs the whole pipeline, and each run computes a *better* estimate of the era's total,
because `reinvested` has accumulated one more validator's contribution and `rate` has been
refreshed.

So the handler must not blindly add on each pass. It reads any `PoolMemberRewards` row already
written for this `(member, era)`, and subtracts that stale value before adding the new one:

```ts
let previousReward: bigint = 0n
const existingReward = await ctx.store.findOneBy(PoolMemberRewards, { id: pmrId })
if (existingReward) {
    previousReward = existingReward.rewards
}
...
const newAccumulated = (member.accumulatedRewards || 0n) + eraRewards - previousReward
```

Net effect: `accumulatedRewards` always reflects the *latest* value for that era, not the sum of
every intermediate estimate. The operation is idempotent — replaying the same event does not
double-count.

### 8.4 A worked numeric example

A pool with 7% commission, 1,000,000 points outstanding, and a member holding 10,000 points
(1% of the pool). Two validators pay out in era 500.

```
STATE AT START OF ERA 500
  points          = 1_000_000
  active stake    = 1_050_000 ENJ
  rate            = 1_050_000 × 1e18 ÷ 1_000_000 = 1.05e18   ("1.05 ENJ per point")
  member points   = 10_000  →  worth 10_000 × 1.05 = 10_500 ENJ

VALIDATOR A PAYS OUT
  reward     = 600 ENJ (gross)
  commission =  42 ENJ (7%)
  netReinvested(600, 42) = 558 ENJ
  EraReward.reinvested = 558 ENJ

VALIDATOR B PAYS OUT (same era → accumulates into the same row)
  reward     = 400 ENJ (gross)
  commission =  28 ENJ (7%)
  netReinvested(400, 28) = 372 ENJ
  EraReward.reinvested = 558 + 372 = 930 ENJ

  ► Under the OLD buggy code this would have been
    (600 + 42) + (400 + 28) = 1_070 ENJ  —  +15.05% too high.

CHAIN STATE AFTER bond_extra
  active stake    = 1_050_000 + 930 = 1_050_930 ENJ
  points          = 1_000_000 (unchanged — rewards do not mint points)
  rate            = 1_050_930 × 1e18 ÷ 1_000_000 = 1.05093e18
  changeInRate    = 1.05093e18 − 1.05e18 = 0.00093e18 = 930_000_000_000_000

MEMBER REWARD
  memberEraReward(10_000, 930_000_000_000_000)
    = 10_000 × 930_000_000_000_000 ÷ 1e18
    = 9.3 ENJ

CROSS-CHECKS
  pro-rata:      1% of 930 ENJ = 9.3 ENJ                            ✓
  balance growth: 10_000 × 1.05093 = 10_509.3 ENJ
                  10_509.3 − 10_500 = 9.3 ENJ                        ✓
  member.bonded  = 10_000 × 1.05093e18 ÷ 1e18 = 10_509.3 ENJ         ✓

  Under the old code the member would have been credited
    10_000 × 1_070 ÷ 1_000_000 = 10.7 ENJ
  — while their balance grew by only 9.3 ENJ. That inconsistency is the bug,
  visible from the user's own numbers.
```

That last line is the practical signature of the bug: reported rewards exceeded the member's
actual balance growth by ~15%.

---

## 9. Repairing the historical data

Fixing the code stops new bad rows. It does not correct the ~9 months of rows already written.
That is what `src/worker/jobs/nomination-pools/backfill-pool-member-rewards.ts` does.

### 9.1 The key insight: no chain replay needed

A naive repair would replay every affected block against an archive node — slow, expensive, and
operationally awkward. The backfill avoids that entirely, because the database already stores the
on-chain-truth columns needed:

- `era_reward.change_in_rate` — was **never** affected by the bug
- `era_reward.rate`, `era_reward.active` — snapshots of chain storage
- `pool_member_rewards.points` — snapshots of chain storage

So the corrected values are recoverable in pure SQL, by inverting the relationships from
[§8.2](#82-the-formulas-collected).

### 9.2 Stage 1 — repair `era_reward.reinvested`

```sql
UPDATE era_reward
SET reinvested = GREATEST(
    TRUNC((change_in_rate * active) / NULLIF(rate, 0)),
    0
)
WHERE id = ANY($1::text[])
  AND rate <> 0
```

Where this comes from:

```
reinvested = changeInRate × totalPoolPoints ÷ 1e18
           = changeInRate × (active × 1e18 ÷ rate) ÷ 1e18
           = changeInRate × active ÷ rate
```

The `1e18` factors cancel, which is why the SQL is so short. `NULLIF(rate, 0)` guards against
division by zero (a pool with no points), `TRUNC` reproduces BigInt integer division, and
`GREATEST(..., 0)` mirrors the clamping in `netReinvested`.

BigInt columns are stored as Postgres `numeric`, which is arbitrary-precision, so the
intermediate `change_in_rate * active` product cannot overflow.

### 9.3 Stage 2 — repair `pool_member_rewards.rewards`

```sql
UPDATE pool_member_rewards AS member_reward
SET rewards = GREATEST(
    TRUNC((member_reward.points * era_reward.change_in_rate) / $1::numeric),
    0
)
FROM era_reward
WHERE member_reward.reward_id = era_reward.id
  AND era_reward.id = ANY($2::text[])
```

A direct SQL translation of `memberEraReward`, with `$1 = 1e18`.

### 9.4 Stage 3 — rebuild the cumulative totals

Per-era rows are now correct, but `accumulated_rewards` is a *running sum*, so it must be
rebuilt in era order using a window function:

```sql
SELECT
    member_reward.id,
    SUM(member_reward.rewards) OVER (
        PARTITION BY member_reward.member_id
        ORDER BY COALESCE(
            member_reward.era_index,
            era.index,
            substring(member_reward.id FROM '-([0-9]+)$')::integer
        ), member_reward.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS accumulated_rewards
FROM pool_member_rewards AS member_reward
LEFT JOIN era_reward ON era_reward.id = member_reward.reward_id
LEFT JOIN era ON era.id = era_reward.era_id
WHERE member_reward.member_id = ANY($1::text[])
```

The three-way `COALESCE` handles rows from different eras of the schema's own history: newer rows
carry `era_index` directly, older ones need the join through `era_reward → era`, and the last
resort parses the era out of the row ID (which has the form `{poolId}-{account}-{era}`). If none
of the three yields an era, the job **throws rather than guessing** — an unorderable row would
silently produce a wrong cumulative sum:

```ts
if (unorderedCount > 0) {
    throw new Error(`Cannot order ${unorderedCount} member reward rows by era`)
}
```

Then `pool_member.accumulated_rewards` is set to each member's grand total, and the job
**self-validates**:

```sql
SELECT COUNT(*)::text AS count
FROM pool_member AS member
INNER JOIN (
    SELECT member_id, SUM(rewards) AS total
    FROM pool_member_rewards
    WHERE member_id = ANY($1::text[])
    GROUP BY member_id
) AS reward_totals ON reward_totals.member_id = member.id
WHERE member.accumulated_rewards IS DISTINCT FROM reward_totals.total
```

Any mismatch aborts the batch:

```ts
if (mismatchCount > 0) {
    throw new Error(`Backfill validation failed for ${mismatchCount} members`)
}
```

### 9.5 Operational properties

| Property | How it is achieved |
|---|---|
| **Idempotent** | Every stage is a pure recomputation from immutable on-chain-truth columns. Re-running produces identical results, so a retry after a crash is safe. |
| **Batched** | Default 100 rows per batch, max 2000. Each batch commits in its own transaction, staying under the Postgres statement timeout. |
| **Resumable** | Keyset pagination on `id` (`WHERE id > $lastId ORDER BY id`) — no `OFFSET`, so cost stays flat as it progresses. |
| **Auto-scoped** | Finds the first affected era itself: `MIN(block_number) FROM chain_info WHERE spec_version >= 1060`, then the earliest `RewardPaid` era at or after that block. |
| **Overridable** | `fromEra` (takes precedence), `fromBlock`, and `batchSize` job parameters. |
| **Observable** | `job.log()` per batch and `job.updateProgress()` throughout (5% → 45% for era rewards, 50% → 95% for member totals). |
| **Convention-agnostic** | Works with both historical `RewardPaid` ID conventions (`event.era` and `event.era + 1`), because it keys off stored rate/points rather than re-deriving era numbers. |

### 9.6 Running it

The job is registered as `JobsEnum.BACKFILL_POOL_MEMBER_REWARDS` in `src/queue/constants.ts`,
routed in `src/worker/processors/nomination_pools.processor.ts`, and dispatched via:

```ts
// src/queue/queue-utils.ts
export function dispatchBackfillPoolMemberRewards(fromBlock?: number): void {
    NominationPoolsQueue.add(
        JobsEnum.BACKFILL_POOL_MEMBER_REWARDS,
        { fromBlock },
        { jobId: `nomination-pools.backfill-member-rewards.${fromBlock ?? 'auto'}` }
    ).catch(() => {
        Logger.error('Failed to dispatch backfill pool member rewards', LOGGER_NAMESPACE)
    })
}
```

Job payload:

```ts
export type BackfillPoolMemberRewardsData = {
    /** Override the automatically detected first post-v1060 block. */
    fromBlock?: number
    /** Override the first affected era. Takes precedence over fromBlock. */
    fromEra?: number
    batchSize?: number
}
```

Recommended sequence when running against production:

1. Take a database snapshot. The job rewrites reward history in place.
2. Dry-run the scope: check how many rows `countAffectedEraRewards` reports for the detected
   `fromEra`.
3. Run with a small `batchSize` first and watch the job log.
4. Spot-check a handful of `(pool, era)` pairs against Subscan before running the full sweep.
5. Confirm no member's `accumulated_rewards` diverges from `SUM(pool_member_rewards.rewards)` —
   the job checks this itself and aborts, but verify independently afterwards.

Note the fixed `jobId` for the `'auto'` case: BullMQ deduplicates by job ID, so an auto-scoped
run cannot be queued twice concurrently.

---

## 10. Bonus-cycle deprecation (a related cleanup)

Runtime v1060 also removed the pool **bonus** mechanism. No bonus has been paid since roughly
era 903. The `bonus` field disappeared from `RewardPaid`, and the pool-create call no longer
accepts a `duration` parameter.

The indexer had not caught up. `created.ts` fabricated a bonus cycle for every new pool using a
hardcoded 300-era default:

```ts
let duration = 300
if (callData.duration) {
    duration = callData.duration
}
...
bonusCycle: new BonusCycle({ start: currentEraInfo, end: currentEraInfo + duration })
```

For a v1060+ pool, `callData.duration` is always `undefined`, so every such pool got a
meaningless `(start, start + 300)` cycle that corresponded to nothing on chain.

The fix populates `bonusCycle` **only when the chain actually provides a duration**:

```ts
// The bonus mechanism was removed in v1060: the create call no longer carries `duration`.
// Populate bonusCycle ONLY when the call actually provides a duration (pre-1060 pools, when
// bonuses were live) so a full resync preserves the real historical cycle; for v1060+ pools
// leave it null instead of fabricating a meaningless (start, start+300) cycle. The GraphQL
// field is kept for nft.io compatibility. See reward-math.ts.
const bonusCycle =
    callData.duration !== undefined
        ? new BonusCycle({ start: currentEraInfo, end: currentEraInfo + callData.duration })
        : null
```

Supporting changes:

- **`schema.graphql`** — `bonusCycle: BonusCycle!` → `bonusCycle: BonusCycle` (nullable), with a
  doc comment explaining when it is populated.
- **`db/migrations/1784714541132-Data.js`** — drops the `NOT NULL` constraint:
  ```js
  await db.query(`ALTER TABLE "nomination_pool" ALTER COLUMN "bonus_cycle" DROP NOT NULL`)
  ```
- **`pool-mutated.ts`** — guards the now-nullable field:
  ```ts
  if (pool.bonusCycle) {
      pool.bonusCycle.pendingDuration = data.mutation.duration
  }
  ```
- **`era-rewards-processed.ts`** — deliberately *keeps* reading `bonusCycle` from storage and
  `EraReward.bonus` from the event. This is the pre-v1060 code path, so it only ever runs during
  a historical resync — and during that period bonuses were real. Preserving it means a full
  resync faithfully reconstructs genuine historical bonus data instead of blanking it.
- **`EraReward.bonus`** is recorded as `0` on the v1060+ path (`reward-paid.ts`,
  `compute-era-rewards.ts`), because the chain no longer reports one.

**No client change is required.** All GraphQL field *names* are unchanged, so Enjin Wallet and
NFT.io continue to read `accumulatedRewards`, `reinvested`, `changeInRate`, and `bonus` exactly
as before. The only behavioural difference a client sees is that `bonusCycle` may now be `null`
for pools created after v1060 — clients should handle that.

---

## 11. Verification

### 11.1 The regression test

`tests/reward-math.test.ts` pins the real pool-98 / era-1126 figures so the bug cannot silently
return:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { memberEraReward, netReinvested } from '~/pallet/nomination-pools/processors/reward-math'

const commission = 14_077_200_000_000_000_000n
const reward = 201_003_300_000_000_000_000n
const changeInRate = 532_539_618_873_000n
const poolPoints = 351_008_796350609579401932n

const toEnj = (value: bigint) => Number(value) / 1e18

void test('calculates pool 98 rewards without double-counting commission', () => {
    const reinvested = netReinvested(reward, commission)
    const buggyReinvested = reward + commission
    const compounded = memberEraReward(poolPoints, changeInRate)

    assert.ok(Math.abs(toEnj(reinvested) - 186.9261) <= 0.01)
    assert.ok(Math.abs(toEnj(buggyReinvested) - 215.0805) <= 0.01)
    assert.ok(Math.abs(toEnj(buggyReinvested - reinvested) - 2 * toEnj(commission)) <= 0.001)
    assert.ok(Math.abs(toEnj(compounded) - 186.9261) <= 0.05)
    assert.ok(Math.abs((195.046193 * 0.93) / 1.07 - 169.504) <= 0.1)
})
```

Four things are asserted, and it is worth being explicit about what each one buys:

1. The corrected figure is `186.9261 ENJ`.
2. The old buggy figure was `215.0805 ENJ`.
3. The difference is *exactly* `2 × commission` — this is the assertion that pins the specific
   nature of the bug, not just the outcome.
4. The independent rate-movement route (`points × changeInRate ÷ 1e18`) agrees with #1, proving
   the two formulas are consistent.

### 11.2 Running the tests

A `test` script was added to `package.json`:

```json
"test": "node --require ts-node/register/transpile-only --require tsconfig-paths/register --test tests/*.test.ts"
```

```bash
pnpm test
```

Supporting config:

- `.github/workflows/tests.yml` — new CI job running `pnpm test` on every push (Node 20, pnpm 9.15.0).
- `tsconfig.json` — `src/**/*.test.ts` added to `exclude`, keeping tests out of the production build.
- `eslint.config.mjs` — ignores `*.test.ts`, since files excluded from the tsconfig project break
  ESLint's `projectService`.

### 11.3 Manual sanity check against Subscan

For any pool and era, all three of these should now agree:

1. `era_reward.reinvested` from the indexer
2. `change_in_rate × active ÷ rate` computed from the same row
3. The reward Subscan reports for that pool and era

And for any member:

```
pool_member_rewards.rewards  ==  points × change_in_rate ÷ 1e18
pool_member.accumulated_rewards  ==  SUM(pool_member_rewards.rewards)
```

The most user-visible check: a member's reported rewards over a period should equal the growth in
`points × rate ÷ 1e18` over that same period. Under the bug, reported rewards exceeded actual
balance growth by ~15%.

---

## 12. Release and deployment status

This section matters as much as the code, because the fix has had an unusually eventful path to
production.

### 12.1 Timeline

Releases in this repository are **tag-driven**: `.github/workflows/publish-dockerhub.yml` builds
and publishes the Docker image on `release: [created]`. A git tag is therefore the deployment
vehicle, which makes the sequence unambiguous.

| Date (UTC+1) | Commit / tag | Reward math on `master` |
|---|---|---|
| 2025-10-30 11:58 | `e1d6607a` — *[NFTIO-3339] indexer update 1060 and matrix1030* (#1655) — **bug introduced** | ❌ broken |
| 2026-07-20 08:58 | **`v3.1.50` released** | ❌ broken |
| 2026-07-22 12:28 | `e3064868` — *[NFTIO-3918] fix pool reward commission double-count* (#1919) — **fix merged** | ✅ correct |
| 2026-08-04 08:58:17 | `e5878bb4` — *Revert "[NFTIO-3918] fix pool reward commission double-count"* (#1931) | ❌ broken |
| 2026-08-04 08:58:53 | **`v3.1.51` released** — 36 seconds after the revert | ❌ broken |
| 2026-08-17 12:17 | `eb3e92dd` — *[NFTIO-3918] fix pool reward calculaion* (#1934) — **fix re-merged** | ✅ correct |

The bug was live on `master` for about **9 months**.

### 12.2 The fix is not yet in any tagged release

Two facts, both verifiable from the repository:

- `v3.1.51` is the newest tag, and it contains **both** `e3064868` and its revert `e5878bb4`.
  Net effect: `v3.1.51` shipped **without** the fix.
- `git tag --contains eb3e92dd` returns nothing. The re-landed fix sits on `master` HEAD along
  with three other unreleased commits (`e299ca64`, `6763b37c`, `defbde3c`).

So as of this document, **the corrected reward math has never appeared in a tagged release** of
the indexer.

### 12.3 The re-land is byte-identical to the original

`git diff e3064868 eb3e92dd` over `src/pallet/nomination-pools/`,
`src/worker/jobs/nomination-pools/`, `db/migrations/`, and `tests/reward-math.test.ts` is
**empty**. The August re-land restored the July fix exactly, with no changes to the logic. Only
unrelated test files (decoder, encoder, metadata) differ between those two commits.

This is useful to know: the fix has not been revised in response to a defect. It was removed and
then restored unchanged.

### 12.4 Why it was reverted (inference, not record)

The repository records no reason for the revert. The commit message is the bare
auto-generated `Revert "..."`.

The strongest available signal is the **36-second gap** between the revert commit (08:58:17) and
the `v3.1.51` tag (08:58:53) on 2026-08-04. That pattern is characteristic of a
release-blocking rollback: the reward change was pulled out so that `v3.1.51` could ship on
schedule, then re-landed two weeks later for a later release.

This is inference from timestamps. It should be confirmed with whoever cut `v3.1.51` before being
treated as fact — see [§13](#13-open-questions).

---

## 13. Open questions

These could not be answered from the repository and need a human.

1. **Is the fix actually live?**
   The corrected math is in no tagged release, and images are published from releases. Unless
   production deploys from `master` directly rather than from release images, **Enjin Wallet and
   NFT.io are most likely still serving the inflated reward figures.** This should be confirmed
   before telling anyone the issue is resolved. If production is release-based, a new tag is
   needed.

2. **Why was the fix reverted on 2026-08-04?**
   The 36-second gap before the `v3.1.51` tag suggests a release-blocking rollback
   ([§12.4](#124-why-it-was-reverted-inference-not-record)), but no reason is recorded. Worth
   confirming there was no *technical* objection to the fix — if there was, it was not addressed,
   since the re-land is byte-identical.

3. **Has the backfill ever been run against production?**
   There is no record in the repository of `BACKFILL_POOL_MEMBER_REWARDS` having been executed.
   Until it runs, **historical rows stay wrong even after the code fix ships** — the code change
   only prevents new bad rows. This is the step that actually corrects what users see for past
   eras.

4. **Do consumers cache reward figures?**
   If Enjin Wallet or NFT.io cache `accumulatedRewards` client-side or in their own layer, those
   caches need invalidating after the backfill, or users will keep seeing the old numbers.

5. **Is there user-facing communication to do?**
   Users' reward histories will visibly *decrease* by ~15% once the backfill runs. That is a
   correction, not a loss — no ENJ ever moved incorrectly, and balances were always right — but
   it will look alarming without an explanation. Worth deciding in advance whether to announce it.

6. **Do downstream analytics need recomputation?**
   `apy`, `average_apy`, and `historical_apy` were derived from the inflated `reinvested`. The
   backfill repairs `reinvested` and the member rows, but does not recompute APY columns. If any
   dashboard or report consumes those, they need a separate pass — most likely by re-running
   `computeEraRewards` for the affected range.

---

## 14. File reference

All paths relative to the indexer repository root.

### Core reward logic

| File | Role |
|---|---|
| `src/pallet/nomination-pools/processors/reward-math.ts` | **New.** The single source of truth: `netReinvested`, `memberEraReward`, and the on-chain-semantics documentation. |
| `src/pallet/nomination-pools/processors/reward-paid.ts` | Live handler for v1060+ `RewardPaid`. Accumulates `EraReward`, computes `changeInRate`, writes member rewards. |
| `src/pallet/nomination-pools/processors/era-rewards-processed.ts` | Handler for the pre-v1060 `EraRewardsProcessed` event. Historical resync path only. |
| `src/pallet/nomination-pools/processors/pool.ts` | `updatePool()` — refreshes points, balances, and `rate` from chain storage; derives the three pool account addresses. |

### Event decoding

| File | Role |
|---|---|
| `src/pallet/nomination-pools/events/reward-paid.ts` | Runtime-version dispatch (`enjinV1062` / `enjinV100` / `v1060`) and the `Event` model row. |
| `src/pallet/nomination-pools/events/types/reward-paid.ts` | `RewardPaid` payload type, annotated with what v1060 added and removed. |
| `src/pallet/nomination-pools/events/types/era-rewards-processed.ts` | Legacy payload type, including the chain-supplied `reinvested`. |

### Workers

| File | Role |
|---|---|
| `src/worker/jobs/nomination-pools/compute-era-rewards.ts` | Bulk recompute of an era's `EraReward` rows from stored `RewardPaid` events. |
| `src/worker/jobs/nomination-pools/compute-pool-member-rewards.ts` | Bulk recompute of member rewards, fetching points over RPC. |
| `src/worker/jobs/nomination-pools/backfill-pool-member-rewards.ts` | **New.** Idempotent batched SQL repair of historical reward rows. |
| `src/worker/processors/nomination_pools.processor.ts` | Routes `BACKFILL_POOL_MEMBER_REWARDS` to the job. |

### Queue wiring

| File | Role |
|---|---|
| `src/queue/constants.ts` | `JobsEnum.BACKFILL_POOL_MEMBER_REWARDS`. |
| `src/queue/queue-utils.ts` | `dispatchBackfillPoolMemberRewards(fromBlock?)`. |

### Bonus-cycle cleanup

| File | Role |
|---|---|
| `src/pallet/nomination-pools/processors/created.ts` | Populates `bonusCycle` only when the create call carries `duration`. |
| `src/pallet/nomination-pools/processors/pool-mutated.ts` | Null-guards `bonusCycle.pendingDuration`. |
| `schema.graphql` | `bonusCycle` made nullable, with an explanatory doc comment. |
| `db/migrations/1784714541132-Data.js` | Drops the `NOT NULL` constraint on `nomination_pool.bonus_cycle`. |
| `src/model/generated/nominationPool.model.ts` | Regenerated model reflecting nullability. |

### Tests and CI

| File | Role |
|---|---|
| `tests/reward-math.test.ts` | Regression test pinning the pool-98 / era-1126 figures. |
| `package.json` | `test` script using `node --test` with `ts-node/register/transpile-only`. |
| `.github/workflows/tests.yml` | CI job running `pnpm test` on push. |
| `tsconfig.json` | Excludes `src/**/*.test.ts` from the build. |
| `eslint.config.mjs` | Ignores `*.test.ts`. |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **Active stake** | ENJ in the bonded account that is actually staked and earning. Read from `Staking.Ledger`. |
| **Bonded account** | Pool account index 1. Holds the staked ENJ. `bond_extra` adds to it. |
| **`bond_extra`** | The extrinsic that adds ENJ to an existing staked position — how pool rewards compound. |
| **Bonus account** | Pool account index 3. Legacy bonus mechanism, removed in v1060. |
| **`changeInRate`** | `rate_this_era − rate_previous_era`. The authoritative basis for member rewards after the fix. Never affected by the bug. |
| **Commission** | Percentage of gross rewards kept by the pool operator. Taken out before compounding. |
| **Era** | Substrate's reward accounting period, ~24h on Enjin. |
| **`EraReward`** | Indexer entity, one row per `(pool, era)`. Holds `reinvested`, `commission`, `rate`, `active`, `changeInRate`, `apy`. |
| **Gross reward** | The amount in `RewardPaid.reward` — before commission is deducted. |
| **`MultiTokens`** | Enjin pallet holding pool points as tokens: collection `1`, token ID = pool ID. |
| **Net reward** | `reward − commission`. The amount that actually compounds. |
| **Planck** | Smallest ENJ unit. 1 ENJ = 1e18 Planck. |
| **Points** | A member's share unit in a pool. Fixed in quantity; its ENJ value rises as `rate` rises. |
| **`PoolMemberRewards`** | Indexer entity, one row per `(member, era)`. Holds `points`, `rewards`, `accumulatedRewards`. |
| **`rate`** | ENJ per point, scaled by 1e18. `active_stake × 1e18 ÷ total_points`. Starts at exactly `1e18`. |
| **`reinvested`** | The net ENJ added to the bonded account for an era — what compounds into `rate`. |
| **Reward account** | Pool account index 2. Temporary landing zone for validator payouts before commission and bonding. |
| **`RATE_PRECISION`** | `10n ** 18n`. The fixed-point scaling factor for `rate` and `changeInRate`. |
| **Slash** | Penalty reducing a validator's (and its nominators') stake. Can make `changeInRate` negative — hence the zero clamps. |
| **Spec version** | Runtime version number. `1060` is the boundary at which the bug was introduced. |
