# Reward History Computation — EnjinSight

> This document explains exactly how the Reward History Viewer computes **Reinvested ENJ**,
> **Reward ENJ**, **Cumulative Rewards**, and **APY** for each era × pool combination.
>
> **Authoritative reference for reward accounting:**
> [`nomination_pool_reward_accounting_fix.md`](./nomination_pool_reward_accounting_fix.md).
> That document explains the on-chain commission semantics in depth; this one describes how
> EnjinSight implements them.

---

## Table of Contents

1. [Background: sENJ Shares vs. ENJ Tokens](#1-background-senj-shares-vs-enj-tokens)
2. [Data Sources](#2-data-sources)
3. [Formula: Reinvested ENJ (net of commission)](#3-formula-reinvested-enj-net-of-commission)
4. [Formula: Member Era Reward](#4-formula-member-era-reward)
5. [Formula: Cumulative Rewards](#5-formula-cumulative-rewards)
6. [Formula: APY](#6-formula-apy)
7. [MultiTokens Storage Encoding](#7-multitokens-storage-encoding)
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

Rewards are **never paid out to members**. They are bonded back into the pool via
`bond_extra`, so the sENJ supply stays fixed while the backing ENJ grows — every member's
position appreciates automatically. "Your reward for era N" is therefore always a *derived*
quantity, not a transfer you can look up.

---

## 2. Data Sources

The Reward History Viewer uses two live data sources plus one static reference:

| Source | What it provides |
|--------|-----------------|
| **Archive RPC** (`state_getStorage`) | Member sENJ balance (`memberBalance`), total pool sENJ supply (`poolSupply`), and the pool's bonded `activeStake` at the era's start block hash |
| **Archive RPC** (`system.events.at`) | `NominationPools` reward events in the block window following the era boundary, from which `reinvested` is derived |
| **relay-era-reference.csv** | Era boundary block numbers and hashes, used to locate the correct archive snapshot and event scan window |

> **Note:** earlier versions of this tool derived `reinvested` from Subscan's `reward_slash`
> endpoint. The live implementation now scans chain events directly over the archive RPC
> (`findReinvestedViaRpc` in `src/hooks/useRewardHistory.js`), which mirrors
> `scripts/staking-rewards-rpc.py`. Subscan is still used elsewhere in the app (pool metadata,
> historical pool discovery, and the Staking Cadence tool).

---

## 3. Formula: Reinvested ENJ (net of commission)

`reinvested` is the ENJ that actually compounded into the pool for a given era. It is derived
from chain events in the block window immediately after the era boundary:

```js
const eventStart = eraEndBoundary            // first block of era N+1
const eventEnd   = eventStart + 40           // 41-block window
```

Two event shapes are handled, depending on the runtime version of the era being scanned:

```js
// Pre-v1060 eras — the chain computed this for us.
if (meth === 'EraRewardsProcessed') {
  return reinvested                          // authoritative, already net of commission
}

// v1060+ eras — one event per nominated validator; accumulate.
if (meth === 'RewardPaid') {
  total += netReinvested(reward, comm)       // max(reward - commission, 0)
}
```

**`RewardPaid.reward` is the GROSS amount**, captured before commission is deducted. On chain,
`claim_commission()` then transfers the commission *out* of the pool's reward account, and only
the remainder is bonded via `bond_extra`. So the amount that compounds — and therefore the amount
that benefits members — is `reward − commission`.

`netReinvested()` lives in [`src/utils/rewardMath.js`](../src/utils/rewardMath.js) and is the
single source of truth for this arithmetic, shared by the hook and the (currently unused)
Subscan-based path in `src/utils/api.js`. `scripts/staking-rewards-rpc.py` and
`scripts/enjinsight_cli.py` implement the identical rule in Python.

> ### Previously incorrect
>
> Until this fix, EnjinSight computed `reward + commission` — **adding** the commission instead
> of subtracting it. That is wrong twice over (failing to subtract, then adding), so every
> affected figure was too high by exactly `2 × commission`:
>
> ```
> buggy / correct = (1 + c) / (1 − c)
> ```
>
> At a 7% commission that is `1.07 / 0.93 ≈ 1.1506`, i.e. **+15.1%**. The error scaled with each
> pool's commission rate, so different pools were wrong by different amounts.
>
> This affected **v1060+ eras only**. The `EraRewardsProcessed` branch was always correct,
> because the chain supplied a figure already net of commission. The identical mistake existed
> independently in Enjin's own backend indexer — see
> [`nomination_pool_reward_accounting_fix.md`](./nomination_pool_reward_accounting_fix.md).

---

## 4. Formula: Member Era Reward

```
reward = (memberBalance × reinvested) / poolSupply
```

Where:
- `memberBalance` — member's sENJ planck at era start block
- `reinvested`    — total ENJ planck that compounded into the pool this era, net of commission
- `poolSupply`    — total sENJ planck in circulation at era start block

**This formula is correct.** `memberBalance / poolSupply` is the member's fractional
share of the pool (pure ratio, unit-independent). Multiplying by `reinvested` (in ENJ
planck) gives the member's ENJ reward in ENJ planck.

Note that it is only correct because `reinvested` is net of commission. The formula is
arithmetically sound either way — it faithfully distributes whatever it is given — so it silently
inherited the full ~15% overstatement while the input was wrong.

### Relationship to the rate-delta formula

Enjin's indexer computes member rewards a different way, from the movement in the pool's
exchange rate:

```
rate         = activeStake × 1e18 / poolSupply
changeInRate = rate_this_era − rate_previous_era
memberReward = memberPoints × changeInRate / 1e18
```

The two are **algebraically equivalent** once `reinvested` is net, because
`reinvested ≈ changeInRate × poolSupply / 1e18`. EnjinSight displays the pro-rata figure.
`memberEraReward()` and `poolRate()` are available in
[`src/utils/rewardMath.js`](../src/utils/rewardMath.js) for cross-checking the two independently.

---

## 5. Formula: Cumulative Rewards

```
accumulated[pool] += reward   (running sum per pool, ordered by era ascending)
```

The cumulative value resets to zero for each new computation run. It represents
the **total ENJ earned by the member from this pool** across all scanned eras.

This formula is correct. Because it is a running sum of per-era rewards, it inherited the
per-era overstatement in full before the commission fix.

---

## 6. Formula: APY

### Per-era APY

```js
const RATIO_PREC = 1_000_000_000n
const apyDenom = activeStake > 0n ? activeStake : poolSupply
const perEraGainScaled = apyDenom > 0n ? (reinvested * RATIO_PREC) / apyDenom : 0n
const ratio = 1 + Number(perEraGainScaled) / Number(RATIO_PREC)
const apy   = (Math.pow(ratio, ERAS_PER_YEAR) - 1) * 100   // ERAS_PER_YEAR = 365
```

The denominator is the pool's bonded `activeStake` (ENJ planck), read from
`Staking.Ledger(poolBondedAccount).active` at the era boundary. This matches units with
`reinvested` (also ENJ planck), avoiding the sENJ/ENJ mismatch. `poolSupply` remains only as a
fallback for when the ledger read fails.

> ### Previously the fallback was always taken
>
> `computePoolBondedAccountId()` derived the pool's bonded account incorrectly in three ways at
> once: it blake2b-hashed the seed (Substrate zero-pads via `TrailingZeroInput`), used the wrong
> `PalletId` (`py/nopo\0` instead of the real runtime constant **`py/nopls`** =
> `0x70792f6e6f706c73`), and used sub-account index `0` instead of `1`.
>
> The derived account did not exist, so `Staking.Ledger` returned nothing, `activeStake` was
> **always `0n`**, and APY silently used the `poolSupply` (sENJ) fallback — the very unit mismatch
> this section claims to avoid. The failure produced no error: `state_getStorage` returns `null`
> for a missing key and `decodeStakingLedgerActive(null)` returns `0n`.
>
> Fixing the derivation makes APY ENJ-denominated for the first time. Because the pool rate is
> well above 1.0 (≈1.88 ENJ per sENJ for the pools sampled), the denominator roughly doubles and
> **displayed APY roughly halves** — e.g. pool 14 at era 1000 moves from ~54.6% to ~26.0%. The
> lower figure is the correct one. `computePoolBondedAccountId` is now covered by unit tests in
> `src/utils/substrate.test.js`.

Scaled BigInt division avoids `Number.MAX_SAFE_INTEGER` precision loss for large planck
values (pool supplies can exceed 10^25).

### Rolling 15-era APY

```js
const ROLLING_WINDOW = 15
// per pool, over a sliding window of up to 15 eras:
rows[i].rollingApy = (Math.pow(windowRatio, ERAS_PER_YEAR / window.length) - 1) * 100
```

Smooths out single-era spikes. Displayed as the `APY 15d*` column.

Both APY figures consume `reinvested`, so both were overstated by the same factor before the
commission fix.

---

## 7. MultiTokens Storage Encoding

`MultiTokens.TokenAccounts.balance` and `MultiTokens.Tokens.supply` are stored as
**SCALE compact-encoded integers**, not fixed-width u128. The raw bytes returned by
`state_getStorage` begin with the compact header at byte 0:

```
mode 0b00 (single byte):   value = byte0 >> 2              (0 – 63)
mode 0b01 (two bytes LE):  value = u16_le(b[0..1]) >> 2     (64 – 16383)
mode 0b10 (four bytes LE): value = u32_le(b[0..3]) >> 2     (up to ~1 billion)
mode 0b11 (big integer):   byte0 = (n-4)<<2|3, n bytes LE follow (n ≥ 4)
```

**The correct decoder is `decodeCompactFirst()`** in `src/utils/substrate.js`. It is what
`useRewardHistory.js` uses for both `memberBalance` and `poolSupply`.

> ### Superseded approach
>
> An earlier iteration assumed these values were fixed u128 behind an `OptionQuery` prefix and
> used `decodeU128OptionFirst()` — reading 16 bytes from offset 1. That is wrong for
> compact-encoded data: for an 8-byte compact balance it runs past the value into the
> `storage_version` field, inflating the result by roughly `5 × 2^120`. Small balances were
> affected badly; some larger ones were accidentally correct when the overrun byte happened to be
> `0x00`. Verified against Python's `substrate-interface`: `decodeCompactFirst` gives 0/18
> mismatches where the old decoder did not.
>
> `decodeStakingLedgerActive()` uses the related `decodeCompactAt()` helper, since
> `StakingLedger.total` and `.active` are also `Compact<u128>`.

---

## 8. Reinvested ENJ — Accuracy Notes

### Why reinvested may appear high

1. **Multiple validator payouts**: A pool nominates multiple validators. Each validator's
   payout fires a separate `RewardPaid` event. Summing them (net of each event's commission)
   equals the pool's total era reward — this is **correct behaviour**, not over-counting.

2. **Block window too wide**: If `endBlock` is estimated (not from the CSV), the 41-block
   window might capture events from the next era. Using accurate `endBlock` values from
   `relay-era-reference.csv` mitigates this.

### Event path by runtime version

- **Pre-v1060 eras**: `NominationPools.EraRewardsProcessed` fires once per pool per era with a
  single `reinvested` field, already net of commission — the most accurate source, used directly.
- **v1060+ eras**: `EraRewardsProcessed` was **removed**. `NominationPools.RewardPaid` fires once
  per nominated validator, carrying a gross `reward` plus a `commission` field. `reinvested` must
  be derived as `Σ max(reward − commission, 0)`.

Since v1060 landed on 2025-10-30 (≈ era 880), the `RewardPaid` path is the **only** path for all
recent history. It is not a rare fallback.

> An earlier revision of this document had these two labels **inverted** — describing
> `EraRewardsProcessed` as the "modern (v1061+)" path and `RewardPaid` as "legacy (pre-v1060)".
> That inversion made the commission-handling defect in the `RewardPaid` branch look like it
> affected only rare legacy data, which is very likely why it went unexamined for so long.

### Commission

Commission **is** subtracted, as of the fix described in [§3](#3-formula-reinvested-enj-net-of-commission).

Commission rates are **not** typically zero. The pool sample captured in
[`nomination_pool_scan_sample_data.md`](./nomination_pool_scan_sample_data.md) shows most pools
with a non-zero rate, many at `100000000` ppb (10%). Any analysis that assumes commission is
negligible will be materially wrong.

### When reinvested appears too low

- If no reward events are found in the 41-block scan window, the viewer logs
  _"no reward events found in blocks X–Y"_ and **skips that era/pool row entirely**. A payout
  landing more than 40 blocks after the era boundary therefore produces a *missing row* rather
  than a visibly wrong number.
- Slash eras reduce the pool's bonded stake. `netReinvested()` and `memberEraReward()` both clamp
  at zero rather than reporting negative rewards.

---

## 9. Summary of Formula Status

| Formula | Status | Notes |
|---------|--------|-------|
| `reinvested = Σ max(reward − commission, 0)` (v1060+) | ✅ Correct | Fixed. Previously `reward + commission`, overstating by `2 × commission` (~+15% at 7%) |
| `reinvested = EraRewardsProcessed.reinvested` (pre-v1060) | ✅ Correct | Chain-supplied, always net of commission — never affected |
| `reward = (memberBalance × reinvested) / poolSupply` | ✅ Correct | Valid pro-rata split; equivalent to the indexer's rate-delta formula once `reinvested` is net |
| `accumulated += reward` | ✅ Correct | Simple running sum |
| `apy = (1 + reinvested/activeStake)^365 − 1` | ✅ Correct | Uses bonded `activeStake` for unit matching; falls back to `poolSupply` if the ledger read fails |
| `rollingApy` (15-era sliding window) | ✅ Correct | Smooths single-era spikes |
| `decodeCompactFirst` | ✅ Correct | MultiTokens balances are SCALE compact, not u128+Option. Supersedes `decodeU128OptionFirst` |
| Reinvested via archive RPC event scan | ⚠️ Window-limited | Accurate when events land within 40 blocks of the era boundary; otherwise the row is skipped |

### Recommended future improvements

1. **Rate-delta watchdog.** Compute `memberEraReward(points, changeInRate)` alongside the
   displayed pro-rata figure and warn when the two diverge. Two independent methods disagreeing
   is exactly the signal that would have caught the commission defect immediately.
2. **Harden the event scan window.** The fixed 40-block window silently drops rows when a payout
   lands late. Widening it, or falling back to the rate-delta figure, would close that gap.
3. **Cap `perEraReturn`** at a reasonable maximum (e.g. 5%) to filter out outlier eras
   caused by bridge payouts or anomalous events.

---

*Last updated: August 2026 | EnjinSight — read-only, no wallet required*
