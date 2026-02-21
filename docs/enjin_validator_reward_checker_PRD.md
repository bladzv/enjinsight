# Enjin Validator Reward Checker — Product Requirements Document

> **Version:** 1.0  
> **Date:** February 20, 2026  
> **Status:** Draft — Pending Engineering Review  
> **Author:** Product Team  
> **Stakeholders:** Engineering, DevOps, Blockchain Operations  
> **Target Chain:** Enjin Relaychain (Nominated Proof of Stake)  
> **Data Source:** Subscan API — `enjin.webapi.subscan.io`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Users & Use Cases](#2-users--use-cases)
3. [Technical Architecture](#3-technical-architecture)
4. [API Specification](#4-api-specification)
5. [Application Flow](#5-application-flow)
6. [UI / UX Specification](#6-ui--ux-specification)
7. [Responsive Design](#7-responsive-design)
8. [Security Requirements](#8-security-requirements)
9. [Functional Requirements](#9-functional-requirements)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [Data Model](#11-data-model)
12. [Risks & Mitigations](#12-risks--mitigations)
13. [Development Milestones](#13-development-milestones)
14. [Future Enhancements](#14-future-enhancements)
15. [Glossary](#15-glossary)

---

## 1. Overview

### 1.1 Purpose

The **Enjin Validator Reward Checker** is a browser-based monitoring tool that connects to the Subscan API to surface real-time staking data about every active validator on the Enjin Relaychain. It allows operators, nominators, and network observers to quickly determine whether validators have been consistently earning rewards across the most recent eras, and to identify any gaps — validators that went silent, fell out of the active set, or were otherwise excluded from reward distribution.

### 1.2 Background & Context

The Enjin Blockchain operates on a **Nominated Proof of Stake (NPoS)** consensus model inherited from the Substrate framework. Validators are elected each era (approximately 24 hours, or 14,400 blocks on the Enjin Relaychain) to produce and attest to blocks. Active validators earn ENJ rewards per era; these rewards flow into nomination pools and are then distributed proportionally to pool members as sENJ appreciates against ENJ.

Because rewards are distributed once per validator per era, any validator that is offline, under-bonded, or excluded from the active set for one or more eras will produce a **gap** in the `era_stat` record. Currently, identifying such gaps requires navigating the Subscan UI manually, validator by validator. This tool automates and aggregates that process.

### 1.3 Problem Statement

Pool operators, delegators, and network analysts currently have no consolidated view of validator reward cadence. The following questions cannot be answered without significant manual effort:

- Which validators missed rewards in the last N eras?
- How many consecutive eras has a given validator been inactive?
- Which nominators are backing underperforming validators?
- How does the era stat pattern of one validator compare to another?

### 1.4 Goals

- Provide a single-page, zero-install tool to check the last X rewards across all validators.
- Surface missing eras visually, making gaps immediately identifiable.
- Show full nominator lists per validator to enable delegation analysis.
- Give full transparency of background API activity via a live terminal log.
- Generate a summary report of validators with reward gaps, suitable for sharing.

### 1.5 Non-Goals

- This tool does **not** submit extrinsics or interact with the chain directly (read-only).
- This tool does **not** manage wallets, private keys, or signing.
- This tool does **not** persist data between sessions (stateless by design in v1).
- This tool does **not** support Enjin Matrixchain or any other parachain.

---

## 2. Users & Use Cases

### 2.1 Target Users

| User Role | Primary Need |
|---|---|
| **Pool Operator** | Manages a nomination pool backed by a Degen NFT; needs to verify their nominated validators are earning consistently every era. |
| **Network Administrator** | Monitors overall validator health across the Enjin Relaychain; needs a bird's-eye view of which validators have gone dark. |
| **ENJ Holder / Delegator** | Has staked ENJ via a pool and wants to verify the validators their pool backs are active and rewarding. |
| **Blockchain Analyst** | Researches staking behaviour, reward patterns, and validator reliability over multiple eras. |

### 2.2 Core Use Cases

#### UC-01 — Check validator reward cadence

A pool operator enters `14` in the input field (last 14 eras ≈ 2 weeks) and clicks **CHECK**. The tool fetches all validators, then queries each validator's `era_stat` history. The operator can see at a glance which validators have a clean 14/14 reward record and which have gaps.

#### UC-02 — Inspect nominator backing

An analyst expands a validator card and views the full list of nomination pools (nominators) backing that validator, including their bonded stake amounts. This helps assess whether a validator is at risk of deactivation due to low nomination.

#### UC-03 — Identify idle validators for pool reassignment

A Degen NFT holder managing a nomination pool uses the Summary section to find validators with consecutive missed eras and decides to re-nominate to a healthier validator.

#### UC-04 — Audit reward transparency

A community member shares a screenshot of the Summary section to publicly document that a specific validator missed rewards over the past 3 eras, creating accountability.

---

## 3. Technical Architecture

### 3.1 Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Browser-only (no backend required in v1) |
| **Framework** | React 18 (Vite build tool) |
| **Styling** | Tailwind CSS v3 |
| **Icons** | Lucide React (`lucide-react`) |
| **HTTP Client** | Native Fetch API (browser) |
| **State Management** | React `useState` / `useReducer` (local) |
| **Data Format** | JSON over HTTPS (Subscan WebAPI) |
| **Hosting** | Static file host (e.g. Vercel, Netlify, GitHub Pages) |

### 3.2 CORS Strategy

The Subscan WebAPI for Enjin returns `Access-Control-Allow-Origin: https://enjin.subscan.io` — direct browser calls from a different origin will be blocked by CORS. Two mitigation options are available:

**Option A — CORS Proxy (Recommended for v1):** Deploy a lightweight Cloudflare Worker or Vercel Edge Function that forwards requests to Subscan and rewrites the `Origin` header. The proxy is a pure passthrough with no business logic. It must whitelist only `enjin.webapi.subscan.io` as a permitted forwarding target.

**Option B — Thin Backend:** A Node.js/Express server performs the API calls server-side and serves results to the frontend. This trades deployment simplicity for full CORS control.

The PRD assumes **Option A** to keep the architecture lean and serverless.

---

## 4. API Specification

### 4.1 Common Request Headers

All three endpoints share the same base configuration:

```
POST https://enjin.webapi.subscan.io/api/scan/staking/[endpoint]

Headers:
  Content-Type:    application/json
  Accept:          application/json
  Origin:          https://enjin.subscan.io
  Referer:         https://enjin.subscan.io/
  Accept-Encoding: gzip, deflate, br
```

### 4.2 Endpoint 1 — Get All Validators

| Field | Value |
|---|---|
| **Method** | `POST` |
| **Path** | `/api/scan/staking/validators` |
| **Purpose** | Fetch the complete list of validators with bonded totals and status |

**Request Payload:**
```json
{
  "order": "desc",
  "order_field": "bonded_total"
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `order` | string | No | Sort direction: `"asc"` or `"desc"` |
| `order_field` | string | No | Field to sort by, e.g. `"bonded_total"` |

**Key response fields to extract per validator:** `account_display.address`, `account_display.display` (human-readable name), `bonded_total`, `bonded_nominators`, `commission`, `status` (active / waiting), `count_nominators`.

### 4.3 Endpoint 2 — Get Nominators per Validator

| Field | Value |
|---|---|
| **Method** | `POST` |
| **Path** | `/api/scan/staking/nominators` |
| **Purpose** | Fetch the list of nominators (nomination pools) backing a specific validator |

**Request Payload:**
```json
{
  "page": 0,
  "row": 100,
  "address": "enB3aj9qMZkHtJy2NwRrx8UvZn83qrfaibpNFgpwt7P3B5yWa",
  "order": "desc",
  "order_field": "bonded"
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `address` | string | **Yes** | The stash address of the target validator |
| `page` | integer | No | Zero-based page index (default: `0`) |
| `row` | integer | No | Results per page (default: `10`, max: `100`) |
| `order` | string | No | Sort direction |
| `order_field` | string | No | `"bonded"` recommended |

**Key response fields per nominator:** `account_display.address`, `account_display.display`, `bonded` (ENJ amount bonded to this validator by this nominator). On Enjin, nominators are typically nomination pool accounts rather than individual wallets.

### 4.4 Endpoint 3 — Get Era Stats per Validator

| Field | Value |
|---|---|
| **Method** | `POST` |
| **Path** | `/api/scan/staking/era_stat` |
| **Purpose** | Fetch the recent era reward history for a specific validator |

**Request Payload:**
```json
{
  "address": "enB3aj9qMZkHtJy2NwRrx8UvZn83qrfaibpNFgpwt7P3B5yWa",
  "row": 14,
  "page": 0
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `address` | string | **Yes** | The stash address of the target validator |
| `page` | integer | No | Zero-based page index (default: `0`) |
| `row` | integer | No | Number of eras to return — set to the user's X value |

**Key response fields per era record:** `era` (era number), `validator_stash_amount` (validator's own bonded amount in Planck), `nominator_stash_amount` (total nominator stake in Planck), `reward` (reward earned in this era in Planck). An absent era in the sequence indicates a missed reward.

---

## 5. Application Flow

### 5.1 Step-by-Step Flow

| Step | Title | Description |
|---|---|---|
| **STEP 1** | Landing Page Load | The app loads with a clean landing page. The user sees a numeric input field labelled "Last N eras to check" pre-filled with a default of `14` (≈ 2 weeks). A **CHECK** button sits beside the input. The terminal log drawer is visible below in a collapsed ready state. No API calls are made on load. |
| **STEP 2** | User Initiates Check | The user enters a number (1–100) and clicks CHECK. Client-side validation runs first. On invalid input, an inline error is shown and no request is sent. On valid input, the terminal log expands and the loading state begins. |
| **STEP 3** | Fetch Validator List | The app posts to `/api/scan/staking/validators`. The terminal logs `[INFO] Fetching validator list from Subscan...` and on success `[OK] Found N validators.` The response is parsed; each validator's address, display name, commission, bonded total, and active status are stored in state. |
| **STEP 4** | Display Validator Cards | Validator cards are rendered sorted by `bonded_total` descending. Each card shows: display name, active/waiting badge, commission %, bonded total (in ENJ), and an expand/collapse chevron. All cards are collapsed by default. |
| **STEP 5** | Fetch Nominators | In parallel (`Promise.allSettled`), the app fires one POST to `/api/scan/staking/nominators` per validator. Each completed request is logged: `[OK] Validator <n>: N nominators found.` Nominators are stored keyed by validator address. |
| **STEP 6** | Fetch Era Stats | Also in parallel, one POST to `/api/scan/staking/era_stat` per validator, with `row` set to the user's X input. Each completed request is logged: `[OK] Validator <n>: era stat fetched (latest era: NNNN).` Era stat arrays are stored keyed by validator address. |
| **STEP 7** | Render Expanded Detail | When a user expands a card, they see two sub-sections: **(a) Nominators** — a paginated table of nominators with address, display name, and bonded ENJ; **(b) Era Stats** — a table of the last X eras showing era number, reward, validator stake, and a colour-coded presence indicator (✅ rewarded / ❌ missing). |
| **STEP 8** | Summary Section | Below the validator list, a Summary section renders automatically once all API calls complete. It shows: total validators checked, validators with at least one missing era with the specific absent era numbers, a perfect-record list, and a critical alert for any validator missing 3+ consecutive eras. |

### 5.2 Parallelism & Request Strategy

Nominator and `era_stat` calls are issued in parallel using `Promise.allSettled()`. A single slow or failed call does not block other validators. Individual card loading states (spinner per card) indicate in-progress data; failed cards show a retry icon.

Because there may be many validators (20–100+), parallel requests are **batched in groups of 10** to avoid flooding the Subscan API. Each batch fires after the previous batch resolves. The batch size is configurable in the app constants file.

---

## 6. UI / UX Specification

### 6.1 Layout Structure

The app is a single-page application (SPA) with no routing. The visual layout is structured into five vertical zones:

| Zone | Content |
|---|---|
| **Zone 1 — App Header** | Logo / title bar, app name, link to Subscan |
| **Zone 2 — Control Panel** | Era input, CHECK button, status indicator (idle / loading / complete) |
| **Zone 3 — Validator List** | Scrollable list of expandable validator cards |
| **Zone 4 — Terminal Log Drawer** | Collapsible monospaced log panel pinned near the bottom |
| **Zone 5 — Summary Section** | Reward gap report, rendered after all data loads |

### 6.2 Lucide Icon Assignments

All icons must be sourced from `lucide-react`.

| Icon Name | Colour | Usage |
|---|---|---|
| `CheckCircle2` | Green | Validator earned reward in this era |
| `XCircle` | Red | Validator missed reward in this era |
| `AlertTriangle` | Amber | Validator has 3+ consecutive missed eras |
| `ChevronDown` | Gray | Expand validator card |
| `ChevronUp` | Gray | Collapse validator card |
| `Terminal` | Purple | Terminal log drawer toggle |
| `Activity` | Purple | Loading / fetching state indicator |
| `Shield` | Green | Active validator status badge |
| `Clock` | Gray | Waiting / inactive validator status badge |
| `Users` | Blue | Nominators sub-section header |
| `BarChart3` | Blue | Era Stats sub-section header |
| `RefreshCw` | Gray | Retry a failed request |
| `Copy` | Gray | Copy validator address to clipboard |
| `ExternalLink` | Gray | Open validator on Subscan in a new tab |
| `Download` | Purple | Export summary as JSON or CSV (v2) |
| `Search` | Gray | Filter validators by name / address |
| `SlidersHorizontal` | Gray | Sort / filter control toggle |

### 6.3 Validator Card — Collapsed State

Each collapsed card displays the following in a single horizontal row:

- `[Shield / Clock]` — status badge (Active in green, Waiting in gray)
- **Display name** (or truncated address if no name is set) — bold
- Commission % — small muted label
- Bonded Total (ENJ) — right-aligned
- `[Copy]` — copy stash address to clipboard
- `[ExternalLink]` — opens the validator's Subscan page in a new tab
- `[ChevronDown]` — expand control

### 6.4 Validator Card — Expanded State

When expanded, two collapsible sub-sections appear below the header row:

**Nominators Sub-section**
Header row: `[Users]` "Nominators" with a count badge. Table columns: Address (truncated + copy icon), Display Name, Bonded (ENJ). Table is paginated at 10 rows. A "Load more" control fetches the next page if more than 10 nominators exist.

**Era Stats Sub-section**
Header row: `[BarChart3]` "Era Rewards" with the range shown (e.g. "Last 14 eras"). Table columns: Era number, Reward (ENJ, 4 decimal places), Validator Stake (ENJ), Nominator Stake (ENJ), Status (`CheckCircle2` or `XCircle`). Missing eras are computed by comparing the returned era numbers against the expected consecutive sequence from the latest era back X steps. If a gap exists, a red row labelled "Era NNNN — No Reward" is inserted.

### 6.5 Terminal Log Drawer

The terminal is a fixed-height (300px) scrollable panel with a dark background (`#0F0D1A`) and monospaced font. Each log line is prefixed with a timestamp (`HH:MM:SS`) and a log level:

| Level | Colour | Meaning |
|---|---|---|
| `[INFO]` | Blue | Neutral operational message |
| `[OK]` | Green | Successful API call |
| `[WARN]` | Amber | Partial data (e.g. a nominator page was truncated) |
| `[ERR]` | Red | A request failed |
| `[DONE]` | Purple | All requests complete, summary ready |

The drawer can be minimised to a slim bar showing only the last log line, or fully expanded. A `[Terminal]` icon and "View Logs" label serve as the toggle.

### 6.6 Summary Section

The Summary section is a distinct visual block rendered below the validator list once all `era_stat` data has resolved. It contains four parts:

**Overview Stats Row:** Three stat chips — total validators checked, total validators with perfect records, total validators with at least one missed era.

**Reward Gap Table:** Lists only validators with one or more missing eras.

| Column | Description |
|---|---|
| Validator Name | Display name or truncated address |
| Eras Checked | The user's X input |
| Eras Rewarded | Count of eras where reward was present |
| Eras Missed | Count of absent eras |
| Missing Era Numbers | Comma-separated list of absent era numbers |
| Severity | Colour-coded: 🟡 1–2 missed / 🟠 3–5 missed / 🔴 6+ missed |

**Critical Alert:** Any validator missing 3 or more consecutive eras is highlighted at the top with an `[AlertTriangle]` icon and a message such as: *"Validator X has missed 4 consecutive eras (1231–1234). Nomination pool operators backing this validator should investigate immediately."*

**Clean Validators:** A collapsed (expandable) list of validators with a perfect X/X reward record, shown as a reassurance block with `[CheckCircle2]` icons.

---

## 7. Responsive Design

### 7.1 Breakpoint Strategy

The app uses Tailwind's standard breakpoints and is designed **mobile-first**:

| Breakpoint | Width | Layout Mode |
|---|---|---|
| `default` (mobile) | < 640px | Single-column, stacked layout |
| `sm` | ≥ 640px | Single-column with increased padding |
| `md` (tablet) | ≥ 768px | Two-column summary stats, wider cards |
| `lg` (desktop) | ≥ 1024px | Full layout, side-by-side panels |
| `xl` | ≥ 1280px | Optimal reading width, max content width capped at 1200px |

### 7.2 Mobile-Specific Layout Rules

#### Zone 1 — App Header
- On mobile, the header collapses to a single line: logo mark + abbreviated app name ("Validator Checker").
- The Subscan external link is moved to a `[ExternalLink]` icon only (no label text) to save horizontal space.

#### Zone 2 — Control Panel
- The era input and CHECK button stack vertically on screens < 640px.
- The CHECK button spans full width on mobile (`w-full`).
- Status indicator (idle / loading / done) appears below the button, centred.

#### Zone 3 — Validator Cards
- On mobile, the collapsed card row wraps into two lines:
  - **Line 1:** Status badge + Display name + `[Copy]` + `[ExternalLink]`
  - **Line 2:** Commission % (left) + Bonded Total (right) + `[ChevronDown]` (rightmost)
- The expanded card shows Nominators and Era Stats as **full-width stacked tables** with horizontal scrolling enabled (`overflow-x-auto`) to prevent layout breaking on narrow screens.
- Era stat table columns on mobile are reduced to: Era, Reward (ENJ), and Status icon — the stake columns are hidden (`hidden md:table-cell`) to prevent overflow.
- Nominator table on mobile shows: Address (truncated to 10 chars) and Bonded only.

#### Zone 4 — Terminal Log Drawer
- On mobile, the terminal drawer is collapsed by default to a slim 40px bar showing the most recent log line.
- Tapping the bar expands it to 200px (shorter than the 300px desktop height).
- The drawer is positioned at the bottom of the screen content flow (not fixed) on mobile to avoid covering the keyboard on iOS/Android.

#### Zone 5 — Summary Section
- Overview stat chips stack vertically (one per row) on mobile instead of the three-column horizontal row on desktop.
- The Reward Gap Table is horizontally scrollable on mobile (`overflow-x-auto` wrapper).
- The Critical Alert banner renders full-width with the icon above the text (stacked) rather than inline.
- The Clean Validators list uses a simple single-column list on mobile.

### 7.3 Touch & Interaction Considerations

- All tap targets must be **minimum 44×44px** (Apple HIG and WCAG 2.5.5 AAA recommendation) including the expand/collapse card chevron, copy icon, and retry icon.
- Card expand/collapse is triggered by tapping **anywhere on the card header row** on mobile (not just the chevron), since chevron-only tapping is difficult on small screens.
- The CHECK button has a minimum height of 48px on mobile.
- Hover states (`:hover`) must be paired with `:focus-visible` equivalents for touch and keyboard users.
- Long validator addresses in the nominator table are truncated with an ellipsis (`truncate`) rather than wrapping across multiple lines.

### 7.4 Typography Scale (Responsive)

| Element | Mobile | Tablet (md) | Desktop (lg) |
|---|---|---|---|
| App Title | `text-xl` | `text-2xl` | `text-3xl` |
| Validator Name | `text-sm font-semibold` | `text-base font-semibold` | `text-base font-semibold` |
| Body / Table | `text-xs` | `text-sm` | `text-sm` |
| Terminal Log | `text-xs font-mono` | `text-xs font-mono` | `text-sm font-mono` |
| Input Field | `text-base` | `text-base` | `text-lg` |

### 7.5 Performance on Mobile

- All API calls use `Promise.allSettled` with batching — this is unchanged on mobile. However, the **batch size may be reduced to 5** on detected mobile connections (via `navigator.connection.effectiveType === '2g' | '3g'`) to avoid memory pressure.
- No images or heavy assets are loaded. The entire UI is CSS + SVG icons, keeping the initial bundle lightweight (target: < 200KB gzipped).
- Lucide icons are tree-shaken by Vite — only imported icons are bundled.

---

## 8. Security Requirements

This section defines security controls that must be implemented to protect the application and its users. Because this is a **client-side, read-only** tool with no database, authentication system, or user accounts, the attack surface is narrow — but not zero.

### 8.1 OWASP Top 10 Mitigation

#### A01 — Broken Access Control
- **Not applicable** in v1: the app has no authentication, user roles, or access-controlled resources.
- The CORS proxy must enforce a strict allowlist: only requests targeting `enjin.webapi.subscan.io` are forwarded. Any attempt to use the proxy as an open relay to arbitrary hosts must return `403 Forbidden`.
- The proxy must reject requests from origins other than the app's own production domain.

#### A02 — Cryptographic Failures
- All traffic must be served over **HTTPS only**. HTTP connections must be redirected to HTTPS (HTTP → HTTPS redirect on the hosting platform).
- The proxy must use TLS 1.2+ when connecting upstream to Subscan.
- No sensitive data (keys, tokens, credentials) is handled by this app. If a future version adds authentication, passwords must never be stored in `localStorage` or `sessionStorage`.

#### A03 — Injection
**XSS (Cross-Site Scripting):**
- All data received from the Subscan API (validator names, addresses, display names) must be treated as untrusted and rendered via React's virtual DOM (JSX), which auto-escapes HTML by default. Never use `dangerouslySetInnerHTML` anywhere in the codebase.
- Validator display names and nominator names sourced from the API must not be rendered as raw HTML under any circumstances.
- The terminal log must similarly sanitise all strings before display — no raw HTML injection via log messages derived from API data.

**SQL Injection:**
- There is no database in v1. This is not applicable. If a backend or caching layer is introduced in v2, parameterised queries must be used exclusively; no string concatenation in query construction.

**Command Injection:**
- The app does not execute system commands. The proxy may not accept any parameter that is passed into a shell command or evaluated as code.

**Path Traversal:**
- The CORS proxy accepts only a fixed set of endpoint path suffixes (`/api/scan/staking/validators`, `/api/scan/staking/nominators`, `/api/scan/staking/era_stat`). Any requested path not in this explicit allowlist must return `400 Bad Request`. The proxy must never accept user-supplied path components that could resolve to filesystem paths.

#### A04 — Insecure Design
- The app follows a **data minimisation** principle: only the fields required for display are extracted from Subscan responses; full response objects are not stored in state.
- The user input (era count) is validated as a safe integer in range 1–100 **before** being used to construct any API payload. It is treated as a number, not a string, and is never interpolated into URLs.
- Threat modelling has been conducted for: CORS bypass, open proxy abuse, reflected XSS via API data, and denial-of-service via large era count. All are addressed in this document.

#### A05 — Security Misconfiguration
All of the following HTTP security headers must be set by the static host and/or CORS proxy:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src https://[proxy-domain];
  img-src 'self' data:;
  font-src 'self';
  frame-ancestors 'none';
  form-action 'self';
  base-uri 'self';

X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

- `unsafe-inline` in `style-src` is permitted only because Tailwind generates inline class-based styles. It must not be extended to `script-src` under any circumstances. If a nonce-based CSP is achievable with the build setup, it is preferred.
- Default Vite/React error overlays and source maps must be **disabled in production builds** (`VITE_MODE=production`). Source maps must not be deployed to the public hosting environment.
- Directory listing must be disabled on the static host.

#### A06 — Vulnerable and Outdated Components
- All dependencies must be audited with `npm audit` as part of the CI pipeline. Builds must fail if `npm audit --audit-level=high` returns any findings.
- `dependabot` or equivalent automated dependency update tooling must be enabled on the repository.
- Only the explicitly required `lucide-react` icons must be imported (tree-shaking). No icon library CDN link may be used in production.
- Third-party CDN dependencies must not be used in the production build (no `<script src="https://cdn...">` in `index.html`).

#### A07 — Identification and Authentication Failures
- v1 has no authentication. No session tokens, JWTs, or cookies are issued.
- If the proxy issues any identifier (e.g. a rate-limiting key), it must be a server-side opaque token and must not contain user-identifying information.

#### A08 — Software and Data Integrity Failures
- The CI/CD pipeline must use **pinned dependency versions** (exact versions in `package.json`, committed `package-lock.json`).
- The CORS proxy must validate that upstream Subscan responses have `Content-Type: application/json` before forwarding. Non-JSON responses from upstream must be rejected and logged, not forwarded to the client.
- No `eval()`, `new Function()`, or dynamic script injection may be used anywhere in the codebase. ESLint with `no-eval` rule must be enforced.

#### A09 — Security Logging and Monitoring Failures
- The CORS proxy must log all incoming requests (timestamp, origin, requested Subscan path, response status code). Logs must not include the full request body (which contains validator addresses but no PII).
- All `[ERR]` entries in the terminal log must correspond to logged events on the proxy side.
- Anomalous traffic patterns (e.g. > 100 requests/minute from a single IP) must trigger an alert.

#### A10 — Server-Side Request Forgery (SSRF)
- The CORS proxy is the primary SSRF risk surface. Mitigations:
  - **Strict URL allowlist**: only `https://enjin.webapi.subscan.io/api/scan/staking/validators`, `/nominators`, and `/era_stat` may be forwarded. No other URLs or hosts.
  - **No user-supplied hostnames**: the proxy constructs the upstream URL from a fixed base — no part of the upstream URL is derived from the client request body or query string (except the path suffix, which is allowlisted).
  - **Block internal IP ranges**: the proxy must reject any upstream URL that resolves to RFC 1918 addresses (10.x, 172.16.x, 192.168.x) or loopback (127.x). This must be enforced at the DNS resolution level.
  - The proxy must not follow HTTP redirects from the upstream server automatically.

### 8.2 Additional Security Controls

#### CSRF (Cross-Site Request Forgery)
- Because the app makes no state-changing requests (all Subscan calls are read-only `POST` operations), CSRF is low risk in v1.
- However, the CORS proxy must validate the `Origin` header on incoming requests and reject any origin not on the allowlist. This prevents a third-party site from embedding the tool in an `<iframe>` and silently using the proxy as a relay.
- `X-Frame-Options: DENY` and `frame-ancestors 'none'` in the CSP prevent the app itself from being embedded in an iframe (clickjacking protection).

#### Clickjacking
- Enforced by `X-Frame-Options: DENY` and `frame-ancestors 'none'` in CSP (see A05).

#### Input Validation & Sanitisation
- The era count input must be validated as a **safe integer (1–100)** using `Number.isInteger()` and range checks. Validation must occur **before** the value is used to construct any JSON payload.
- Validator address fields (used as API request parameters) are taken directly from prior API responses — they are never supplied by the end user and must not be treated as user-controlled input.
- No user-supplied content is ever sent to a server as executable code or a URL path component.

#### Dependency Integrity
- `package-lock.json` must be committed and locked. `npm ci` (not `npm install`) must be used in CI.
- Subresource Integrity (SRI) hashes must be applied to any external resources if used (currently none planned).

#### Rate Limiting
- The CORS proxy must enforce rate limiting: **maximum 60 requests per minute per IP**. Requests exceeding this limit must receive `429 Too Many Requests` with a `Retry-After` header.
- The client-side batch size (≤ 10 concurrent requests) provides a natural secondary throttle.

#### Error Handling & Information Disclosure
- All error messages shown to the user in the terminal log and card error states must be generic: e.g. `"Request failed — please retry"`. Raw error objects, stack traces, upstream error responses, and internal server details must never be surfaced to the UI.
- The proxy must strip any `Server`, `X-Powered-By`, or other server-identifying headers from upstream responses before forwarding to the client.

#### Supply Chain Security
- All npm packages must be reviewed for licence compatibility and known malicious packages before addition. The `npm audit` gate in CI is mandatory.
- A `SECURITY.md` file must be included in the repository describing how to report vulnerabilities.

---

## 9. Functional Requirements

| ID | Requirement | Description |
|---|---|---|
| **FR-01** | Input Validation | The era count input must accept only integers in the range 1–100. Non-integer and out-of-range input must be rejected with an inline error before any API call is made. |
| **FR-02** | Validator List Fetch | The app must call `/api/scan/staking/validators` on CHECK and parse the full list of validators from the JSON response. |
| **FR-03** | Parallel Sub-Queries | Nominator and era_stat requests must be issued in parallel, batched at ≤ 10 concurrent requests, using `Promise.allSettled` so that individual failures do not block other validators. |
| **FR-04** | Missing Era Detection | The app must detect missing eras by comparing the era numbers returned in `era_stat` against the expected sequence (latest_era down to latest_era − X + 1) and marking absent eras as missed. |
| **FR-05** | Expand / Collapse Cards | Each validator card must be independently expandable and collapsible without triggering new API calls if data has already been loaded. |
| **FR-06** | Terminal Logging | Every API call (start, success, failure) must emit a timestamped log line to the terminal drawer in real time. |
| **FR-07** | Summary Generation | Once all era_stat data has resolved, the Summary section must be rendered with gap analysis, severity rating, and any critical consecutive-miss alerts. |
| **FR-08** | Copy Address | All validator and nominator addresses must have a one-click copy-to-clipboard function via the `[Copy]` icon. |
| **FR-09** | Retry on Failure | A `[RefreshCw]` icon on a failed card must allow the user to re-trigger the API calls for that specific validator without re-fetching the entire list. |
| **FR-10** | External Links | All validator cards and summary rows must include a `[ExternalLink]` icon that opens the corresponding Subscan page in a new tab with `rel="noopener noreferrer"`. |
| **FR-11** | Responsive Layout | The app must be fully usable on desktop (≥ 1024px), tablet (≥ 768px), and mobile (≥ 320px) screen widths per the breakpoint rules defined in Section 7. |
| **FR-12** | ENJ Formatting | All ENJ amounts returned in Planck units (10¹⁸) must be converted and displayed as decimal ENJ with appropriate precision (4 decimal places for rewards, 2 for large stake figures). |
| **FR-13** | Mobile Card Adaptation | On screens < 640px, the validator card collapsed state must wrap to two lines, the era stat table must hide stake columns, and the nominator table must reduce to address + bonded columns only. |
| **FR-14** | Secure External Links | All `target="_blank"` links must include `rel="noopener noreferrer"` to prevent reverse tabnapping. |
| **FR-15** | No dangerouslySetInnerHTML | API-sourced strings must never be rendered via `dangerouslySetInnerHTML`. All string content must pass through React's JSX rendering pipeline. |

---

## 10. Non-Functional Requirements

### 10.1 Performance

- The validator list fetch must complete and render within 3 seconds on a standard broadband connection.
- The parallel sub-query phase (nominators + era_stat for all validators) must complete within 30 seconds for up to 50 validators.
- Cards must render progressively — each card's data appears as soon as its individual requests resolve, without waiting for all validators to finish.
- Initial bundle size must be < 200KB gzipped.

### 10.2 Reliability

- All API calls must use a 15-second timeout. Timed-out requests must be marked as failed in the terminal log and shown as an error state on the card.
- The app must remain functional even if up to 20% of sub-queries fail — partial data is better than no data. Failed validators are flagged, not hidden.

### 10.3 Accessibility

- All interactive elements must be keyboard-navigable (tab-focusable, enter/space activated).
- Colour-coded status indicators must always be accompanied by a text or icon label — never colour alone — to support colour-blind users.
- Contrast ratios must meet WCAG 2.1 AA standard (4.5:1 for normal text, 3:1 for large text).
- All touch targets must be minimum 44×44px (WCAG 2.5.5).
- `aria-label` attributes must be applied to all icon-only buttons (Copy, ExternalLink, RefreshCw, ChevronDown/Up).

### 10.4 Maintainability

- API base URL and all endpoint paths must be defined in a single constants file for easy update if Subscan changes URLs.
- The batch size for parallel requests must be a configurable constant (default: `10`).
- ENJ Planck-to-decimal conversion logic must be isolated in a utility function with unit tests.
- The missing era computation algorithm must have unit tests covering: perfect record, all missed, partial gaps, single validator, empty response.

---

## 11. Data Model

### 11.1 Client-Side State Shape

```typescript
interface AppState {
  eraCount: number;                      // user input, 1–100
  status: 'idle' | 'loading' | 'done' | 'error';
  logs: LogEntry[];                      // terminal log lines
  validators: ValidatorRecord[];         // full list after Step 3
}

interface ValidatorRecord {
  address: string;                       // stash address
  display: string;                       // human-readable name or truncated address
  commission: number;                    // percentage e.g. 5
  bondedTotal: bigint;                   // Planck units — use BigInt to avoid overflow
  isActive: boolean;
  nominators: NominatorRecord[] | null;  // null = not yet fetched
  eraStat: EraStatRecord[] | null;       // null = not yet fetched
  missedEras: number[];                  // computed after era_stat resolves
  fetchStatus: 'pending' | 'loading' | 'done' | 'error';
}

interface NominatorRecord {
  address: string;
  display: string;
  bonded: bigint;                        // Planck units
}

interface EraStatRecord {
  era: number;
  reward: bigint;                        // Planck units
  validatorStake: bigint;                // Planck units
  nominatorStake: bigint;                // Planck units
}

interface LogEntry {
  timestamp: string;                     // HH:MM:SS
  level: 'INFO' | 'OK' | 'WARN' | 'ERR' | 'DONE';
  message: string;
}
```

> ⚠️ **Critical:** All on-chain ENJ values are in Planck units (10¹⁸). JavaScript's `number` type cannot safely represent values above 2⁵³ − 1. All stake and reward fields **must** be stored as `BigInt` and converted to string/decimal only at the display layer.

### 11.2 Missing Era Computation Algorithm

```typescript
// latestEra = max(era) across all validators' era_stat responses (global reference)
// eraCount  = user's X input

function computeMissedEras(
  eraStat: EraStatRecord[],
  latestEra: number,
  eraCount: number
): number[] {
  const expected = new Set(
    Array.from({ length: eraCount }, (_, i) => latestEra - i)
  );
  const received = new Set(eraStat.map(e => e.era));
  return [...expected]
    .filter(era => !received.has(era))
    .sort((a, b) => b - a); // descending (most recent first)
}

// Consecutive miss detection:
function findConsecutiveMissedEras(missedEras: number[]): number[][] {
  if (missedEras.length === 0) return [];
  const sorted = [...missedEras].sort((a, b) => b - a);
  const groups: number[][] = [];
  let currentGroup = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1] - sorted[i] === 1) {
      currentGroup.push(sorted[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }
  groups.push(currentGroup);
  return groups.filter(g => g.length >= 3); // only flag groups of 3+
}
```

### 11.3 ENJ Formatting Utility

```typescript
const PLANCK_PER_ENJ = BigInt('1000000000000000000'); // 10^18

function formatENJ(planck: bigint, decimals: number = 4): string {
  const whole = planck / PLANCK_PER_ENJ;
  const remainder = planck % PLANCK_PER_ENJ;
  const decimalStr = remainder.toString().padStart(18, '0').slice(0, decimals);
  return `${whole.toLocaleString()}.${decimalStr} ENJ`;
}

function truncateAddress(address: string, start = 8, end = 6): string {
  if (address.length <= start + end + 3) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}
```

---

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Subscan API rate-limits responses | Medium | High | Implement exponential backoff with jitter; proxy enforces ≤ 60 req/min/IP; log all non-200 responses |
| CORS blocks browser-origin requests | High | High | Deploy a CORS proxy as Milestone 1 — nothing else can proceed without it |
| Large validator sets cause slow load times | Medium | Medium | Batch parallel requests (≤ 10); add per-card loading states; progressive rendering |
| Planck unit overflow in JavaScript number | High | Medium | Use `BigInt` for all on-chain values; convert to string for display only |
| Display names missing (address-only validators) | Low | Low | Fall back to truncated address (first 8 + last 6 chars) with copy icon |
| Subscan API schema change breaks parsing | Low | High | Defensive optional chaining (`?.`) throughout; unit tests with recorded response fixtures |
| User enters large N (e.g. 100) causing timeouts | Low | Medium | Hard cap at 100; display a warning for N > 30; per-request timeout at 15s |
| Open proxy abuse (proxy used to hit other hosts) | Medium | High | Strict upstream allowlist; origin header validation; rate limiting per IP |
| XSS via malicious validator display name | Low | High | React JSX auto-escaping; `no-dangerouslySetInnerHTML` ESLint rule enforced |
| Tabnapping via external links | Medium | Medium | All `target="_blank"` links use `rel="noopener noreferrer"` |

---

## 13. Development Milestones

| ID | Milestone | Est. Duration | Deliverables |
|---|---|---|---|
| **M1** | Infrastructure | 1 week | CORS proxy deployed and verified; Subscan endpoints tested from browser; project scaffold (Vite + React + Tailwind + Lucide) committed; CI pipeline with `npm audit` gate |
| **M2** | API Integration | 1 week | All 3 endpoints integrated with correct payloads; response parsers with `BigInt` handling; terminal log infrastructure; unit tests for parsers, missing era computation, consecutive miss detection, and ENJ formatting |
| **M3** | Core UI | 1 week | Landing page, control panel, validator card (collapsed + expanded states), terminal drawer — all wired to live data; mobile layout implemented and tested on iOS Safari and Chrome Android |
| **M4** | Summary Section | 3 days | Missing era detection, gap table, severity classification, consecutive-miss alerting, clean validator list — fully rendered and tested |
| **M5** | Security & Polish | 3 days | All OWASP mitigations verified; CSP headers configured; accessibility pass (keyboard nav, ARIA labels, contrast check); error/retry states; copy-to-clipboard; external links with `rel="noopener noreferrer"`; performance profiling |
| **M6** | Deploy | 1 day | Production build deployed to static host; `SECURITY.md` committed; smoke-tested against live Enjin Relaychain data; source maps confirmed absent from production |

---

## 14. Future Enhancements (v2+)

### 14.1 Export Functionality
Allow users to export the full summary and raw era stat data as CSV or JSON via the `[Download]` icon. This enables offline analysis and sharing in governance discussions.

### 14.2 Historical Comparison
Store previous check results in `localStorage` (with the user's explicit consent and a clear data retention disclosure) and surface a trend view showing whether a validator's reward rate is improving or declining over successive checks.

### 14.3 Validator Filtering & Search
Add a search input and filter controls (active only, missing > N eras, commission > X%, etc.) to support large validator sets. The `[Search]` and `[SlidersHorizontal]` icons are pre-allocated in the icon spec for this purpose.

### 14.4 Slashing Event Detection
Query Subscan's slashing event endpoints in addition to `era_stat` to flag validators that have been slashed. Slashing reduces staked ENJ for both the validator and its backing nomination pools — critical information for pool operators.

### 14.5 Nomination Pool Overlay
Cross-reference validators with the nomination pool list from Subscan to show which specific pools are nominating each validator, with pool details (bonus cycle, capacity, sENJ supply). This closes the loop from the nominator address back to the pool controlling it.

### 14.6 Era Duration Calendar Mapping
Display era timestamps alongside era numbers (1 era ≈ 24 hours on the Enjin Relaychain at 14,400 blocks/era) to make "last N eras" intuitively map to calendar dates for non-technical users.

### 14.7 Authentication & Multi-User Mode (v3)
For network operators managing multiple stakeholders, a lightweight authentication layer could enable saved views, validator watchlists, and email/webhook alerts when a watched validator misses a reward.

---

## 15. Glossary

| Term | Definition |
|---|---|
| **ENJ** | Native token of the Enjin Blockchain, used for staking, fees, and governance. |
| **sENJ** | Staked ENJ — a liquid token representing a user's share in a nomination pool. 1 sENJ is minted per ENJ bonded; its value grows as rewards accumulate. |
| **Era** | A validator session on the Enjin Relaychain lasting 14,400 blocks (~24 hours). Active validators earn rewards per era. |
| **Validator** | A full node on the Enjin Relaychain elected to produce and attest blocks. Must be nominated by at least one pool to be active. |
| **Nominator** | An account (in practice, a nomination pool account) that delegates stake to one or more validators. |
| **Nomination Pool** | A smart contract-like entity controlled by a Degen NFT holder. Users bond ENJ to pools; pools nominate validators collectively. Minimum deposit: 2,500 ENJ. |
| **Degen NFT** | A special NFT (collection ID 2) required to create a nomination pool on the Enjin Blockchain. |
| **Commission** | A percentage of era rewards taken by the validator (and optionally by the pool owner) before distributing to nominators. |
| **Planck** | The smallest unit of ENJ on-chain. 1 ENJ = 10¹⁸ Planck. All on-chain values are in Planck units. |
| **Slashing** | A penalty applied when a validator misbehaves (e.g. double-signing, extended offline period). Reduces staked ENJ for both the validator and its nominators. |
| **era_stat** | The Subscan API record representing a validator's reward activity in a single era. An absent record for an era implies no reward was earned in that era. |
| **NPoS** | Nominated Proof of Stake — the consensus mechanism used by the Enjin Relaychain, inherited from Substrate. |
| **Stake Factor** | A nomination pool's total bonded ENJ divided by total sENJ supply. Used to calculate how much ENJ a member can unbond. |
| **Subscan** | A blockchain explorer for Substrate-based chains. The Enjin Blockchain's Subscan instance is hosted at `enjin.subscan.io`. |
| **CORS** | Cross-Origin Resource Sharing — a browser security mechanism that restricts which origins can make requests to a given API. |
| **SSRF** | Server-Side Request Forgery — an attack where a server-side component is tricked into making requests to unintended internal or external targets. |
| **Planck Overflow** | A precision bug where JavaScript's `number` type (IEEE 754 double) cannot safely represent Planck-unit values above 2⁵³ − 1. Avoided by using `BigInt`. |
| **CSP** | Content Security Policy — an HTTP response header that controls which resources the browser is allowed to load, mitigating XSS and injection attacks. |

---

*Enjin Validator Reward Checker — PRD v1.0 — February 2026 — Confidential, Internal Use Only*
