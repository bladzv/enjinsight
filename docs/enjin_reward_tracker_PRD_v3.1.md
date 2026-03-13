# Enjin Staking Reward Tracker — Product Requirements Document

**Version:** 3.1  
**Last Updated:** 2026-03-12  
**Status:** Active  
**Scope:** Per-era ENJ equivalent gain for a Relaychain wallet address, with tranche-accurate sENJ balance history, date/era range filtering, interactive visualization, and multi-format export.

---

## A Note on the Reference Prototype

A JSX prototype (`enjin_reward_tracker_prototype.jsx`) accompanies this PRD. It implements a subset of the features described here and serves as a **visual and interaction reference** — particularly for the table layout, collapsible row design, Stake Factor gauge, and chart tab structure.

**The prototype is not a constraint.** Implementors are free to make different design, layout, and technology choices. The prototype exists to illustrate *one valid interpretation* of this document, not the only one. Where the prototype and PRD conflict, the PRD takes precedence.

Features implemented in the prototype: collapsible era rows, per-pool expanded detail, Stake Factor gauge with progress bar, multi-tab chart (Cumulative / Per-Era Gain / Stake Factor), chart-to-table hover sync, per-pool summary cards.

Features specified in this PRD but not in the prototype: entry mode selection screen, date/era range filtering with presets, era_stat-based authoritative block ranges, export (JSON/CSV/XML), AES-GCM encryption, file import mode.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Block Time & Era Reference](#2-block-time--era-reference)
3. [Entry Modes](#3-entry-modes)
4. [Date / Era Range Filtering](#4-date--era-range-filtering)
5. [Data Fetching Flow — Wallet Mode](#5-data-fetching-flow--wallet-mode)
6. [Data Import Flow — File Mode](#6-data-import-flow--file-mode)
7. [Output: Per-Day Table](#7-output-per-day-table)
8. [Output: Interactive Graph](#8-output-interactive-graph)
9. [Output: Export & Encryption](#9-output-export--encryption)
10. [API Reference Summary](#10-api-reference-summary)
11. [Known Limitations](#11-known-limitations)
12. [References](#12-references)

---

## 1. Overview

### Purpose

This web application allows Enjin Relaychain wallet holders to view and export a per-era breakdown of their staking rewards expressed as ENJ equivalent growth — reconstructed accurately using the wallet's full sENJ mint/burn activity history across all nomination pools.

### Why ENJ Equivalent, Not Token Count

Enjin staking does not distribute tokens. Instead:

- Users stake ENJ → receive **sENJ** tokens representing their share of a pool
- Each era, the pool stash receives a staking reward → bonded back into the pool stash
- The **Stake Factor** (Pool Bonded ENJ ÷ Total sENJ Supply) increases each era
- The user's ENJ equivalent grows without their sENJ balance changing

```
ENJ Equivalent = sENJ balance × Stake Factor
Per-era gain   = sENJ balance (at that era) × ΔStake Factor
ΔStake Factor  = Era reward amount ÷ Total sENJ supply
```

### Why Tranche Accuracy Matters

If a user bonds additional ENJ midway through the tracked period, their sENJ balance increases at that point. Using today's balance for all historical eras overstates early gains. The correct approach reconstructs the **actual sENJ balance at each era's timestamp** by replaying on-chain mint/burn history.

---

## 2. Block Time & Era Reference

### Enjin Relaychain (Staking Layer)

| Property | Value |
|---|---|
| Block time | **6 seconds** (constant — never changed) |
| Blocks per era | 14,400 |
| Era duration | 14,400 × 6s = **86,400 seconds = exactly 24 hours** |
| Era cadence | 1 era per day |

### Enjin Matrixchain (NFT/Token Layer)

| Property | Value |
|---|---|
| Block time before Bugis upgrade | 12 seconds |
| Block time after Bugis upgrade | **6 seconds** |
| Bugis upgrade date | March 24, 2025 (~18:45 UTC) |
| Bugis upgrade start block | 4,017,535 |

### Impact on This Tracker

The Matrixchain block time change **does not affect staking reward calculations**, because:

1. All staking (validators, nomination pools, sENJ) lives on the **Relaychain** only
2. sENJ activity events are matched to era reward events using **`block_timestamp`** (Unix seconds), not block height — timestamps are chain-agnostic

No split-era calculation is required. Era-to-date conversion uses a constant 6-second Relaychain block time throughout.

### Era ↔ Block ↔ Date Conversion

```
Block number → Date:
  timestamp = genesis_timestamp + (block_num × 6)

Date → Block number:
  block_num = (target_unix_timestamp - genesis_timestamp) / 6

Date → Era number:
  era = floor(block_num / 14400)

Era → Block range:
  start_block = era × 14400
  end_block   = (era + 1) × 14400 - 1

Era → Date:
  date = genesis_date + (era × 1 day)
```

> Use `staking/era_stat` (Step A3) as the authoritative source for era-to-block mapping. The formulas above are for pre-filtering and UI display only.

---

## 3. Entry Modes

The application presents **two mutually exclusive entry modes** at launch. The user selects one before any other UI is shown.

### Mode A — Wallet Query

The user inputs:
- Enjin Relaychain wallet address (SS58 format, prefix `en`)
- Subscan API key (`X-API-Key`)
- Date or era range (see Section 4)

The app fetches all data live from Subscan APIs and computes results.

### Mode B — File Import

The user imports a previously exported file (JSON, CSV, or XML — see Section 9).

The app parses the file, validates its schema, and renders the same table and graph as Mode A without making any API calls. This allows users to review past exports offline, share data with accountants or tax advisors, and re-render encrypted exports after decrypting.

---

## 4. Date / Era Range Filtering

### Input Options

Users may specify the range using either:

- **Date range:** Two calendar date pickers (from / to), converted to era numbers at query time
- **Era range:** Two numeric inputs (from era / to era)

### Preset Buttons

Six quick-select presets displayed above the date pickers:

| Label | Range |
|---|---|
| 1 Week | Last 7 eras |
| 1 Month | Last 30 eras |
| 3 Months | Last 90 eras |
| 6 Months | Last 180 eras |
| 1 Year | Last 365 eras |
| All Time | All available history (up to Subscan history depth) |

### Range Validation Rules

- Maximum range: **365 eras** (1 year) per query
- Minimum range: **1 era**
- Future dates are rejected
- Dates before pool genesis are clamped to pool creation era

### Date-to-Era Conversion at Query Time

```
1. Resolve target date to Unix timestamp (midnight UTC)
2. Fetch era_stat to get authoritative block ranges
3. Find the era whose start_block_num corresponds to the closest block at that timestamp
4. Use era_stat block ranges as the authoritative filter
```

---

## 5. Data Fetching Flow — Wallet Mode

---

### Step A1 — Fetch All Nomination Pools

**Purpose:** Discover all pools on the network and their stash account addresses.

**Endpoint:**
```
POST https://enjin.api.subscan.io/api/scan/nomination_pool/pools
```

**Documentation:** `https://support.subscan.io/api-4245389`

**Request:**
```http
POST /api/scan/nomination_pool/pools HTTP/1.1
Host: enjin.api.subscan.io
Content-Type: application/json
X-API-Key: YOUR_API_KEY_HERE

{
  "page": 0,
  "row": 100
}
```

**Key Response Fields:**
```json
{
  "code": 0,
  "data": {
    "count": 15,
    "list": [
      {
        "pool_id": 10,
        "stash": "enFzJ3...LEirTy",
        "state": "Open",
        "bonded_total": "16774930306000000000000000",
        "points": "15975647000000000000000000"
      }
    ]
  }
}
```

**Rationale:** `stash` is the pool's bonded account used in A4. `pool_id` maps to the sENJ token ID used in A2 and A6. Paginate until all pools are retrieved.

---

### Step A2 — Check Wallet sENJ Balance Per Pool

**Purpose:** Determine which pools the wallet is a member of and retrieve the current sENJ balance for each.

**Endpoint:**
```
POST https://matrix.api.subscan.io/api/scan/enjin/multitoken/holder_balance
```

**Documentation:** `https://support.subscan.io/api-4379657`

**Request:**
```http
POST /api/scan/enjin/multitoken/holder_balance HTTP/1.1
Host: matrix.api.subscan.io
Content-Type: application/json
X-API-Key: YOUR_API_KEY_HERE

{
  "collection_id": "1",
  "token_id": "10",
  "account": "en1WalletAddressHere"
}
```

> Repeat for each `pool_id` from Step A1. Skip pools where balance is `0`.

**Key Response Fields:**
```json
{
  "code": 0,
  "data": {
    "balance": "952380000000000000000",
    "token_id": "10",
    "collection_id": "1"
  }
}
```

**Rationale:** `balance` ÷ 10^18 = current sENJ balance. Non-zero pools proceed to all subsequent steps.





```json
{
    "code": 0,
    "message": "Success",
    "generated_at": 1773388612,
    "data": {
        "native": [
            {
                "symbol": "ENJ",
                "unique_id": "ENJ",
                "decimals": 18,
                "balance": "199999997452137878",
                "lock": "0",
                "reserved": "0",
                "bonded": "0",
                "unbonding": "0",
                "democracy_lock": "0",
                "conviction_lock": "0",
                "election_lock": "0",
                "label": null,
                "price": "0.01870861"
            }
        ],
        "assets": [
            {
                "symbol": "sENJ",
                "unique_id": "enjin_multi_token/1",
                "decimals": 0,
                "balance": "6019650718069627508524",
                "asset_id": "1",
                "token_image": "",
                "label": null
            }
        ],
        "count": 1
    }
}
```








---

### Step A3 — Map Era Range to Block Ranges

**Purpose:** Convert the user-selected date or era range into authoritative block ranges. Source of truth for all era/date/block data shown in the output.

**Endpoint:**
```
POST https://enjin.api.subscan.io/api/scan/staking/era_stat
```

**Documentation:** `https://support.subscan.io/api-4212520`

**Request:**
```http
POST /api/scan/staking/era_stat HTTP/1.1
Host: enjin.api.subscan.io
Content-Type: application/json
X-API-Key: YOUR_API_KEY_HERE

{
  "address": "<any_active_validator_stash>",
  "page": 0,
  "row": 100
}
```

**Key Response Fields:**
```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "era": 487,
        "start_block_num": 7027200,
        "end_block_num": 7041599,
        "validator_reward": "10174000000000000000000",
        "nominator_reward": "9665300000000000000000"
      }
    ]
  }
}
```

**Rationale:** Provides `start_block_num` and `end_block_num` per era used to construct `block_range` filters for Step A4 and to populate the Era, Block Range, and Date columns in the output table.

---

### Step A4 — Fetch Pool Stash Reward History

**Purpose:** Retrieve every `staking.Rewarded` event for each pool's stash account within the selected block range. Each event = one era payout.

**Endpoint:**
```
POST https://enjin.api.subscan.io/api/scan/account/reward_slash
```

**Documentation:** `https://support.subscan.io/api-4193056`

**Request:**
```http
POST /api/scan/account/reward_slash HTTP/1.1
Host: enjin.api.subscan.io
Content-Type: application/json
X-API-Key: YOUR_API_KEY_HERE

{
  "address": "enFzJ3...LEirTy",
  "is_stash": true,
  "category": "Reward",
  "block_range": "7027200-7468799",
  "page": 0,
  "row": 100
}
```

> `block_range` derived from Step A3. Paginate until batch size < `row`.

**Key Response Fields:**
```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "block_num": 7041500,
        "block_timestamp": 1735084800,
        "amount": "6613900000000000000000",
        "event_id": "Rewarded",
        "module_id": "staking",
        "event_index": "7041500-3",
        "stash": "enFzJ3...LEirTy"
      }
    ]
  }
}
```

**Rationale:** `amount` (Plancks) is the ENJ bonded into the pool stash that era. `block_timestamp` matches against the wallet's sENJ balance timeline in Step A7. Sort ascending by `block_num`.

---

### Step A5 — Fetch Pool Info (Stake Factor Anchor)

**Purpose:** Get current `bonded_total` and `points` (total sENJ supply) to compute the current Stake Factor, which anchors the backwards reconstruction.

**Endpoint:**
```
POST https://enjin.api.subscan.io/api/scan/nomination_pool/pool
```

**Documentation:** `https://support.subscan.io/api-4245386`

**Request:**
```http
POST /api/scan/nomination_pool/pool HTTP/1.1
Host: enjin.api.subscan.io
Content-Type: application/json
X-API-Key: YOUR_API_KEY_HERE

{
  "pool_id": 10
}
```

**Key Response Fields:**
```json
{
  "code": 0,
  "data": {
    "pool_id": 10,
    "stash": "enFzJ3...LEirTy",
    "bonded_total": "16774930306000000000000000",
    "points": "15975647000000000000000000"
  }
}
```

```
Current Stake Factor = bonded_total ÷ points
                     = 16,774,930.306 ÷ 15,975,647
                     = 1.0500300...
```

**Rationale:** `points` = total sENJ supply (Substrate calls member shares "points"). `bonded_total` = ENJ locked in the pool stash. Their ratio is the Stake Factor.

---

### Step A5b — Reconstruct Stake Factor Per Era (Computed)

**No API call — computed from Steps A4 and A5.**

**Algorithm:**
```
Sort reward events ascending by block_num

bonded_after[last] = current bonded_total

For i from last down to 0:
  bonded_before[i]  = bonded_after[i] - amount[i]
  bonded_after[i-1] = bonded_before[i]

SF_after[i]  = bonded_after[i]  ÷ total_sENJ_supply
SF_before[i] = bonded_before[i] ÷ total_sENJ_supply
ΔSF[i]       = amount[i]        ÷ total_sENJ_supply
```

**Rationale:** Total sENJ supply (`points`) is treated as constant across eras. Valid because sENJ supply only changes on member bond/unbond events, not on reward distribution.

---

### Step A6 — Fetch Wallet sENJ Activity History

**Purpose:** Retrieve the complete mint/burn/transfer history of the wallet's sENJ for each pool — the source data for tranche-accurate balance reconstruction.

**Endpoint:**
```
POST https://matrix.api.subscan.io/api/scan/enjin/multitoken/activities
```

**Documentation:** `https://support.subscan.io/api-4379658`

**Request:**
```http
POST /api/scan/enjin/multitoken/activities HTTP/1.1
Host: matrix.api.subscan.io
Content-Type: application/json
X-API-Key: YOUR_API_KEY_HERE

{
  "collection_id": "1",
  "token_id": "10",
  "account": "en1WalletAddressHere",
  "page": 0,
  "row": 100
}
```

> Fetch **all history regardless of selected range** — balance at range start requires all prior events.

**Key Response Fields:**
```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "block_num": 3456000,
        "block_timestamp": 1730000000,
        "type": "Mint",
        "amount": "1000000000000000000000",
        "from": null,
        "to": "en1WalletAddressHere"
      }
    ]
  }
}
```

**Activity type → balance effect:**

| type | Condition | Effect |
|---|---|---|
| Mint | — | +amount |
| Burn | — | −amount |
| Transfer | `to` == wallet | +amount |
| Transfer | `from` == wallet | −amount |

---

### Step A7 — Reconstruct Wallet sENJ Balance Timeline (Computed)

**No API call — computed from Step A6.**

```
Sort activity events ascending by block_timestamp

balance = 0, timeline = []
For each event:
  apply balance delta (see table above)
  balance = max(0, balance)
  timeline.append({ timestamp, balance })

For era reward at timestamp T:
  active_balance = latest timeline entry where entry.timestamp ≤ T
  if T is before first entry → active_balance = 0 (not yet a member)
```

---

### Step A8 — Compute Per-Era ENJ Equivalent Gain (Computed)

**No API call — computed from Steps A5b and A7.**

```
Per-era gain (era i)  = active_sENJ(era i) × ΔSF(era i)
ENJ Equivalent (era i) = active_sENJ(era i) × SF_after(era i)
```

**Output record per era:**
```json
{
  "date": "2025-12-26",
  "era": 487,
  "start_block": 7027200,
  "end_block": 7041599,
  "active_senj_balance": 1952.38,
  "stake_factor_before": 1.049512,
  "stake_factor_after": 1.050319,
  "delta_sf": 0.000807,
  "per_era_gain_enj": 1.576,
  "enj_equivalent": 2050.42,
  "pool_id": 10
}
```

---

### Step A9 — Aggregate Across Pools (Computed)

**No API call — computed from Step A8 for all pools, grouped by date.**

```json
{
  "date": "2025-12-26",
  "era": 487,
  "start_block": 7027200,
  "end_block": 7041599,
  "per_era_gain_enj": 2.841,
  "total_enj_equivalent": 3218.73,
  "cumulative_gain": 84.23,
  "pools": [
    { "pool_id": 10, "gain": 1.576, "equiv": 2050.42, "sf_after": 1.050319, "active_senj": 1952.38 },
    { "pool_id": 0,  "gain": 1.265, "equiv": 1168.31, "sf_after": 1.049801, "active_senj": 1000.00 }
  ]
}
```

---

## 6. Data Import Flow — File Mode

When the user selects File Import at the entry screen:

1. A file picker accepts `.json`, `.csv`, `.xml`, and `.enc` files
2. If the file contains `"encrypted": true` (JSON/XML) or is a `.enc` file, a password prompt is shown before parsing
3. Decryption uses AES-GCM with PBKDF2 key derivation (see Section 9)
4. After decryption, the app validates the schema against the export format
5. The table and graph from Sections 7 and 8 are rendered using imported data
6. The Export panel (Section 9) is available for re-exporting in a different format

**No API calls are made in File Import mode.**

---

## 7. Output: Per-Day Table

### Columns

| Column | Description | Source |
|---|---|---|
| Date | Calendar date (YYYY-MM-DD) | `block_timestamp` → UTC |
| Era | Era number | Step A3 (era_stat) |
| Block Range | `start_block – end_block` | Step A3 (era_stat) |
| Stake Factor | SF after era reward (with ΔSF) | Step A5b |
| ΔStake Factor | SF increase that era | Step A5b |
| Active sENJ | Wallet sENJ balance active that era | Step A7 |
| Per-Era Gain (ENJ) | ENJ equivalent earned that era | Step A8 |
| Total ENJ Equiv. | ENJ value of all sENJ holdings | Step A8 |
| Cumulative Gain | Running total of per-era gains | Step A9 |

### Collapsible Rows

Each row is expandable. Clicking a row reveals:

**Stake Factor detail panel** showing:
- Stake Factor before the era reward
- Stake Factor after the era reward
- ΔStake Factor
- Plain-English interpretation (e.g. "Every 1 sENJ is now worth 1.0503... ENJ")

**Per-pool breakdown cards** (one card per pool the wallet is in) showing:
- Pool ID
- Active sENJ balance that era
- Pool's Stake Factor (before and after)
- Pool's bonded ENJ (before and after)
- Era reward amount received by pool
- This pool's contribution to wallet's per-era gain
- This pool's ENJ equivalent
- Percentage of total era gain attributed to this pool

> **Prototype reference:** The collapsible row toggle, expand animation, pool card grid layout, and Stake Factor detail panel are demonstrated in `enjin_reward_tracker_prototype.jsx`. Implementors are not required to follow this visual design — it serves as a functional and layout reference only.

### Table Behaviour

- Default sort: descending by date (most recent first)
- Clickable column headers toggle ascending/descending sort
- Clicking a row expands it; clicking again collapses it
- Hovered or chart-synced rows are visually highlighted
- Multiple rows may be expanded simultaneously

---

## 8. Output: Interactive Graph

### Chart Tabs

Three views, toggled by tab buttons:

1. **Cumulative ENJ Equivalent** — area chart of total ENJ value of holdings over time
2. **Per-Era Gain** — bar chart of ENJ earned per era; stacked by pool when wallet is in multiple pools
3. **Stake Factor** — line chart of Stake Factor growth over time, one line per pool

> **Prototype reference:** The three-tab chart structure, stacked bar pool breakdown, and Stake Factor line chart are demonstrated in `enjin_reward_tracker_prototype.jsx`.

### Hover / Click Tooltip

Hovering or clicking any data point shows a detailed tooltip containing:

- Date
- Era number
- Block range (`start_block – end_block`)
- Active sENJ balance that era
- Stake Factor before and after
- ΔStake Factor
- Per-era gain (ENJ)
- Total ENJ equivalent across all pools
- Per-pool gain breakdown (when wallet is in multiple pools)

### Graph ↔ Table Sync

- Hovering a chart data point highlights the corresponding table row
- Clicking a chart data point expands that row in the table
- Clicking a table row highlights the corresponding chart point

> **Prototype reference:** The hover sync and click-to-expand interaction is demonstrated in `enjin_reward_tracker_prototype.jsx`.

---

## 9. Output: Export & Encryption

### Export Panel Controls

| Control | Description |
|---|---|
| Format selector | JSON \| CSV \| XML (radio buttons) |
| Filename input | Free text; default: `enjin_rewards_<unix_timestamp>` |
| Encrypt toggle | Checkbox to enable AES-GCM encryption |
| Password input | Shown only when Encrypt is enabled |
| Confirm password | Shown only when Encrypt is enabled |
| Export button | Triggers download |

### Default Filename

```
enjin_rewards_<unix_timestamp>.<ext>
```

Example: `enjin_rewards_1735084800.json`

With encryption enabled:
```
enjin_rewards_1735084800.json.enc
```

### Export Formats

**JSON:**
```json
{
  "meta": {
    "wallet": "en1abc...xyz",
    "exported_at": 1735084800,
    "range_from_era": 460,
    "range_to_era": 490,
    "range_from_date": "2025-11-26",
    "range_to_date": "2025-12-26",
    "encrypted": false
  },
  "data": [
    {
      "date": "2025-12-26",
      "era": 487,
      "start_block": 7027200,
      "end_block": 7041599,
      "active_senj_balance": 1952.38,
      "stake_factor_before": 1.049512,
      "stake_factor_after": 1.050319,
      "delta_stake_factor": 0.000807,
      "per_era_gain_enj": 2.841,
      "total_enj_equivalent": 3218.73,
      "cumulative_gain": 84.23,
      "pools": [
        { "pool_id": 10, "gain_enj": 1.576, "enj_equivalent": 2050.42, "active_senj": 1952.38, "sf_after": 1.050319 },
        { "pool_id": 0,  "gain_enj": 1.265, "enj_equivalent": 1168.31, "active_senj": 1000.00, "sf_after": 1.049801 }
      ]
    }
  ]
}
```

**CSV:**
```csv
date,era,start_block,end_block,active_senj_balance,stake_factor_before,stake_factor_after,delta_stake_factor,per_era_gain_enj,total_enj_equivalent,cumulative_gain,pool_10_active_senj,pool_10_sf_after,pool_10_gain,pool_10_equiv,pool_0_active_senj,pool_0_sf_after,pool_0_gain,pool_0_equiv
2025-12-26,487,7027200,7041599,1952.38,1.049512,1.050319,0.000807,2.841,3218.73,84.23,1952.38,1.050319,1.576,2050.42,1000.00,1.049801,1.265,1168.31
```

**XML:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<EnjinRewardExport>
  <Meta>
    <Wallet>en1abc...xyz</Wallet>
    <ExportedAt>1735084800</ExportedAt>
    <RangeFromEra>460</RangeFromEra>
    <RangeToEra>490</RangeToEra>
    <RangeFromDate>2025-11-26</RangeFromDate>
    <RangeToDate>2025-12-26</RangeToDate>
    <Encrypted>false</Encrypted>
  </Meta>
  <Data>
    <Era date="2025-12-26" era="487" startBlock="7027200" endBlock="7041599"
         activeSENJ="1952.38" sfBefore="1.049512" sfAfter="1.050319" deltaSF="0.000807"
         perEraGainENJ="2.841" totalENJEquiv="3218.73" cumulativeGain="84.23">
      <Pool id="10" activeSENJ="1952.38" sfAfter="1.050319" gainENJ="1.576" enjEquiv="2050.42"/>
      <Pool id="0"  activeSENJ="1000.00" sfAfter="1.049801" gainENJ="1.265" enjEquiv="1168.31"/>
    </Era>
  </Data>
</EnjinRewardExport>
```

### Encryption Specification

Encryption is performed entirely in the browser using the **Web Crypto API**. No server involved.

- **Algorithm:** AES-GCM-256
- **Key derivation:** PBKDF2 (SHA-256, 100,000 iterations, random 16-byte salt)
- **IV:** Random 12 bytes, generated per export

**Encrypted file envelope (JSON wrapper around any format):**
```json
{
  "encrypted": true,
  "format": "csv",
  "algorithm": "AES-GCM-256",
  "kdf": "PBKDF2-SHA256",
  "iterations": 100000,
  "salt": "<base64>",
  "iv": "<base64>",
  "ciphertext": "<base64>"
}
```

On import, if `"encrypted": true` is detected, the app prompts for a password and decrypts using the stored `salt`, `iv`, and `iterations`. The decrypted content (JSON/CSV/XML) is then parsed normally.

A warning is displayed before encrypting that **password recovery is impossible** if the password is lost.

---

## 10. API Reference Summary

| Step | Endpoint | Host | Purpose | Paginated |
|---|---|---|---|---|
| A1 | `POST /api/scan/nomination_pool/pools` | enjin.api.subscan.io | List all pools | Yes |
| A2 | `POST /api/scan/enjin/multitoken/holder_balance` | matrix.api.subscan.io | Current sENJ balance per pool | No |
| A3 | `POST /api/scan/staking/era_stat` | enjin.api.subscan.io | Era → block range mapping | Yes |
| A4 | `POST /api/scan/account/reward_slash` | enjin.api.subscan.io | Pool stash reward history | Yes |
| A5 | `POST /api/scan/nomination_pool/pool` | enjin.api.subscan.io | Current bonded ENJ + sENJ supply | No |
| A5b | (computed) | — | Stake Factor per era reconstruction | — |
| A6 | `POST /api/scan/enjin/multitoken/activities` | matrix.api.subscan.io | Wallet sENJ mint/burn history | Yes |
| A7 | (computed) | — | sENJ balance timeline | — |
| A8 | (computed) | — | Per-era ENJ gain with tranche accuracy | — |
| A9 | (computed) | — | Multi-pool aggregation by date | — |

All API requests:
- Method: `POST`
- `Content-Type: application/json`
- `X-API-Key: <user-supplied key>`

---

## 11. Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| Subscan history depth (~84 eras) | Reward events older than ~84 days may not appear | Display visible date range in UI header |
| Total sENJ supply treated as constant per pool | Slight SF inaccuracy in eras with many bonds/unbonds | Acceptable for tax use; note in UI |
| `block_timestamp` used for era matching | Late-triggered payouts group by payout date, not earned date | Note in tooltip |
| Matrixchain block time change (Mar 24 2025) | Does not affect Relaychain staking calculations | No action required |
| Max range 365 eras per query | Cannot export more than 1 year in one request | User runs multiple exports for multi-year history |
| Encryption is browser-side only | Password recovery is impossible if lost | Warning shown before encrypting |
| sENJ transferred between wallets | Shows as Burn on sender, Mint on receiver | Both wallets tracked correctly if queried separately |

---

## 12. References

| Resource | URL |
|---|---|
| Reference Prototype (JSX) | `enjin_reward_tracker_prototype.jsx` (accompanying file) |
| Enjin Bugis Upgrade Blog Post | https://enjin.io/blog/enjin-blockchain-bugis-upgrade-and-new-marketplace-pallet-features |
| Subscan API — Nomination Pool List | https://support.subscan.io/api-4245389 |
| Subscan API — Nomination Pool Info | https://support.subscan.io/api-4245386 |
| Subscan API — Nomination Pool Activities | https://support.subscan.io/api-4245385 |
| Subscan API — Nomination Pool Rewards | https://support.subscan.io/api-4245390 |
| Subscan API — Account Reward/Slash | https://support.subscan.io/api-4193056 |
| Subscan API — Era Stat List | https://support.subscan.io/api-4212520 |
| Subscan API — Enjin MultiToken Holder Balance | https://support.subscan.io/api-4379657 |
| Subscan API — Enjin MultiToken Activities | https://support.subscan.io/api-4379658 |
| Enjin Staking Documentation | https://docs.enjin.io/enjin-blockchain/staking |
| Web Crypto API — AES-GCM | https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt |
| Web Crypto API — PBKDF2 | https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey |
