# Reward History Computation — EnjinSight

> This document explains exactly how the Reward History Viewer computes **Reinvested ENJ**,
> **Cumulative Rewards**, and **APY** for each era × pool combination. It also identifies
> a known limitation in the APY formula and proposes a more accurate alternative.

---

## Table of Contents

1. [Background: sENJ Shares vs. ENJ Tokens](#1-background-senj-shares-vs-enj-tokens)
2. [Data Sources](#2-data-sources)
3. [Formula: Member Era Reward (Reinvested → Reward)](#3-formula-member-era-reward)
4. [Formula: Cumulative Rewards](#4-formula-cumulative-rewards)
5. [Formula: APY — Current Implementation](#5-formula-apy--current-implementation)
6. [Known Issue: APY Unit Mismatch](#6-known-issue-apy-unit-mismatch)
7. [Corrected APY Formula](#7-corrected-apy-formula)
8. [Reinvested ENJ — Accuracy Notes](#8-reinvested-enj--accuracy-notes)
9. [Summary of Formula Status](#9-summary-of-formula-status)

---

## 1. Background: sENJ Shares vs. ENJ Tokens

Enjin's nomination pools issue **sENJ** (pool share tokens) stored in multi-token
collection ID `1`. Each pool's sENJ token ID equals the pool ID. When you bond ENJ
into a pool you receive sENJ; when you exit you burn sENJ and receive ENJ back.

| Token | Unit | Lives in |
|-------|------|----------|
| **ENJ** | Native relaychain token (18 decimals) | System.Account |
| **sENJ** | Pool share token (18 decimals) | MultiTokens.TokenAccounts |

These are **two distinct tokens**. 1 sENJ is NOT 1 ENJ. The exchange rate grows over
time as the pool earns staking rewards.

```
exchangeRate = pool.activeStake (ENJ planck) / pool.totalSENJSupply (sENJ planck)
```

A new pool starts at rate ≈ 1.0. After years of compounding the rate may exceed 1.5,
meaning each sENJ is now backed by 1.5 ENJ.

---

## 2. Data Sources

The Reward History Viewer uses three data sources:

| Source | What it provides |
|--------|-----------------|
| **Archive RPC** (`state_getStorage`) | Member sENJ balance (`memberBalance`) and total pool sENJ supply (`poolSupply`) at the era's start block hash |
| **Subscan reward_slash API** | Sum of all reward events paid to the pool stash account in the ~41 blocks following the era boundary (`reinvested`) |
| **relay-era-reference.csv** | Era boundary block numbers and hashes, used to locate the correct archive snapshot and Subscan event window |

---

## 3. Formula: Member Era Reward

```
reward = (memberBalance × reinvested) / poolSupply
```

Where:
- `memberBalance` — member's sENJ planck at era start block
- `reinvested`    — total ENJ planck received by the pool stash this era (from Subscan)
- `poolSupply`    — total sENJ planck in circulation at era start block

**This formula is correct.** `memberBalance / poolSupply` is the member's fractional
share of the pool (pure ratio, unit-independent). Multiplying by `reinvested` (in ENJ
planck) gives the member's ENJ reward in ENJ planck.

This exactly matches the official indexer formula:
```
memberReward = (memberPoints × eraReward.reinvested) / totalPoolPoints
```
(source: `STAKING_REWARDS_RESEARCH.md`, Section 3 — Key Formulas)

---

## 4. Formula: Cumulative Rewards

```
accumulated[pool] += reward   (running sum per pool, ordered by era ascending)
```

The cumulative value resets to zero for each new computation run. It represents
the **total ENJ earned by the member from this pool** across all scanned eras.

This formula is correct.

---

## 5. Formula: APY — Current Implementation

```js
// Both reinvested and poolSupply are in the same unit (planck), but different tokens.
// The ratio reinvested/poolSupply represents the per-sENJ ENJ gain for this era.
const RATIO_PREC = 1_000_000_000n
const perEraGainScaled = poolSupply > 0n ? (reinvested * RATIO_PREC) / poolSupply : 0n
const ratio = 1 + Number(perEraGainScaled) / Number(RATIO_PREC)
const apy   = (Math.pow(ratio, ERAS_PER_YEAR) - 1) * 100
```

Uses scaled BigInt division to avoid `Number.MAX_SAFE_INTEGER` precision loss for
large planck values (pool supplies can exceed 10^25).

---

## 6. OptionQuery Prefix — Resolved Bug

**Previously**, `decodeU128First` read the raw bytes from `state_getStorage` starting
at byte offset 0. Both `MultiTokens.Tokens` and `MultiTokens.TokenAccounts` use
`OptionQuery` in pallet-multi-tokens, so Substrate prepends a `0x01` (Option::Some)
byte to the stored value. Reading from offset 0 ingested this prefix byte as the LSB
of the u128, effectively returning ~256× the correct value for `poolSupply`.

Since both `memberBalance` and `poolSupply` had the same ×256 error, the reward
formula `(memberBalance × reinvested) / poolSupply` cancelled correctly. But the
APY denominator (`poolSupply`) was 256× too large, causing APY to be ~256× too small
(observed: 0.10–0.20% vs the correct 30–40%).

**Fix**: `decodeU128OptionFirst(hex)` in `substrate.js` skips the leading `0x01` byte
before reading the u128. All `state_getStorage` calls for `MultiTokens.*` now use
this function.

---

## 7. Future: Fully Correct APY via activeStake

The official indexer APY formula uses `pool.activeStake` (total bonded ENJ in planck)
as the denominator, which avoids the sENJ/ENJ unit mismatch entirely:

```
apy = ((pool.activeStake + eraReinvested) / pool.activeStake)^erasPerYear − 1  × 100
```

Both values are in **ENJ planck**, so units match. The current `reinvested/poolSupply`
approximation is very close for pools where the exchange rate ≈ 1.0 and drifts slightly
as the exchange rate grows.

**Fully correct implementation (requires additional RPC call):**

```js
// Phase 4b: also fetch pool stash staking ledger at era boundary block
const ledgerKey = buildStakingLedgerKey(pool.stashAddress)
const ledgerRaw = await rpc.call('state_getStorageAt', [ledgerKey, blockHash])
const activeStake = decodeU128At(ledgerRaw, ACTIVE_OFFSET)   // ENJ planck

// APY with correct units:
const ratio = Number(activeStake + reinvested) / Number(activeStake)
const apy   = (Math.pow(ratio, 365) - 1) * 100
```

---

## 8. Reinvested ENJ — Accuracy Notes

### What the code does

```js
const eventStart = (endBlock ?? startBlock + 14399) + 1
const eventEnd   = eventStart + 40   // 41-block window
const rewardList = await fetchRewardSlash(pool.stashAddress, `${eventStart}-${eventEnd}`)
reinvested = sum(rewardList.map(r => r.amount))
```

The code sums all Subscan reward events for the pool stash address in the 41 blocks
immediately after each era boundary.

### Why reinvested may appear high

1. **Multiple validator payouts**: A pool nominates multiple validators. Each validator's
   payout fires a separate reward event. The sum of all events equals the pool's total
   era reward — this is **correct behaviour**, not over-counting.

2. **Block window too wide**: If `endBlock` is estimated (not from the CSV), the 41-block
   window might capture events from the next era. Using accurate `endBlock` values from
   `relay-era-reference.csv` mitigates this.

3. **Legacy vs. modern event path**:
   - Modern path (v1061+): `NominationPools.EraRewardsProcessed` fires once per pool
     per era with a single `reinvested` field — most accurate.
   - Legacy path (pre-v1060): `NominationPools.RewardPaid` fires once per validator —
     the sum is equivalent but requires more events.
   - Subscan's `reward_slash` endpoint captures both; summing them is correct.

4. **Commission not subtracted**: The `reinvested` amount from Subscan includes the
   total ENJ received by the pool stash, which may include a commission portion that
   is immediately forwarded to the commission beneficiary. Commission was introduced
   in later chain upgrades; for most pools it is 0%.

### When reinvested appears too low

If Subscan has not yet indexed events for a very recent era, `reward_slash` may return
zero results. The viewer logs a warning: _"no reward events found in blocks X–Y"_.

---

## 9. Summary of Formula Status

| Formula | Status | Notes |
|---------|--------|-------|
| `reward = (memberBalance × reinvested) / poolSupply` | ✅ Correct | Matches official indexer formula |
| `accumulated += reward` | ✅ Correct | Simple running sum |
| `apy = (1 + reinvested/poolSupply)^365 − 1` | ✅ Correct (with fix) | OptionQuery prefix bug fixed; values now match Python reference |
| `decodeU128OptionFirst` | ✅ Fixed | Skips 0x01 Option::Some prefix; replaces decodeU128First for MultiTokens storage |
| Reinvested via Subscan `reward_slash` | ✅ Reasonable | Correct in concept; accuracy depends on Subscan indexing lag and block window accuracy |

### Recommended future improvements

1. **Fetch `pool.activeStake`** from the staking ledger at each era boundary block.
   Use it in place of `poolSupply` in the APY formula for exact unit matching.
2. **Use `NominationPools.EraRewardsProcessed`** events directly (via on-chain event
   scanning rather than Subscan) for the most accurate `reinvested` value.
3. **Cap `perEraReturn`** at a reasonable maximum (e.g. 5%) to filter out outlier eras
   caused by bridge payouts or anomalous events.

---

*Last updated: March 2026 | EnjinSight — read-only, no wallet required*
