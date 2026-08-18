# EnjinSight — Frontend Redesign Brief

> Audience: an AI design / engineering agent producing a brand-new design system and frontend for EnjinSight without changing tool behavior, data sources, or business logic.
>
> Read this document end-to-end. It enumerates every page, every interactive control, every data binding, every state, and every export the current app supports. Anything not listed here should not be added; anything listed here must remain reachable in the redesign.

---

## 1. What the App Is

EnjinSight is a **read-only, no-wallet, no-database** web app for inspecting Enjin Blockchain data. It is a static React SPA (Vite build) deployed to Vercel with one serverless catch-all proxy that injects API keys (`SUBSCAN_API_KEY`, `ETHERSCAN_API_KEY`, optionally `ALCHEMY_ETH_RPC_URL`) so they never appear in the browser bundle.

Five tools, plus a landing page:

| Tool key | View | Purpose |
|----------|------|---------|
| `era` | Era Block Explorer | Live era / session / block + past-era lookup on Enjin Relaychain |
| `staking` | Staking Rewards Cadence | Validator and nomination-pool reward-cadence scans |
| `balance` | Historical Balance Viewer | Multi-network archive-node balance history with charts and export |
| `reward-history` | Reward History Viewer | Per-era pool reward computation for one Relaychain address |
| `infusion` | ENJ Infusion Checker | Ethereum ERC-1155 ENJ infusion lookup by token ID or wallet |

Data sources:

- Substrate WebSocket RPC (live + archive nodes) — direct from browser, no secret needed
- Subscan REST API — through same-origin encoded proxy `/api/<encoded-url>`
- Etherscan API — through same-origin routes `/api/enj-wallet-tokens`, `/api/enj-token-details`
- Ethereum JSON-RPC — through same-origin route `/api/eth-call` (Alchemy-first, Etherscan-fallback)
- Bundled CSV files: `public/relay-era-reference.csv` (~1007+ rows) and `public/canary-relay-era-reference.csv`

---

## 2. Architecture Constraints (must not change)

The redesign is **frontend only**. These rules are non-negotiable:

1. **No global state library.** Each tool is isolated in its own `useReducer`/custom hook (see §11).
2. **API key never in browser.** Subscan calls go through `/api/<encoded-url>`; Etherscan/Alchemy via the same-origin routes above.
3. **Path allowlist enforced.** Only the endpoints in `src/constants.js → ENDPOINTS` are accepted by the proxy.
4. **No `innerHTML` / `dangerouslySetInnerHTML`.** All user-controlled content rendered via JSX or escaped manually (XML export).
5. **BigInt for balances.** ENJ amounts are `BigInt` Planck units (1 ENJ = 10^18 Planck), formatted only at display time.
6. **Log cap 500** (Era Explorer caps at 200) — circular trim to prevent memory growth.
7. **AbortController** must back every cancellable async chain. Every "Stop" button must abort cleanly.
8. **WebSocket cleanup**: every WS instance must `.close()` in `finally`, with timers cleared.
9. **Hash-based routing.** The active view persists in `window.location.hash` (`#era`, `#staking`, `#balance`, `#reward-history`, `#infusion`, or empty for home).
10. **Sticky terminal log** is part of the experience on every tool view (see §6).
11. **First-visit disclaimer** (5-second countdown) and "About" modal must remain.
12. **WCAG AA** color contrast and visible `:focus-visible` outlines required.
13. **Reduce motion / coarse pointer** — pointer-aura cursor effect must be disabled for `(pointer: coarse)` and `(prefers-reduced-motion: reduce)`.
14. **Vercel Analytics** is lazy-loaded if `@vercel/analytics/react` is installed; do not crash if absent.

---

## 3. Tech Stack (current — replace any UI layer freely)

- React 18 + Vite 7
- Tailwind CSS 3 (current design tokens in `tailwind.config.js`)
- Lucide React icon set
- Chart.js 4 (used by Balance and Reward History viewers)
- `@noble/hashes` (Blake2b, twox, PBKDF2 for export crypto)
- `@polkadot/api`, `@polkadot/util-crypto` (SS58, SCALE)
- Web Crypto API (AES-256-GCM)
- Vitest + jsdom

A redesign may swap Tailwind for any styling solution and Chart.js for any chart lib, provided every existing chart mode and tooltip behavior is preserved (see §7.3.6).

---

## 4. Global App Shell

### 4.1 Layout

- Single-page app, fixed sticky **header** (`<AppHeader />`) at top.
- Single sticky **terminal log drawer** at the bottom of every tool view (Era / Staking / Balance / Reward History / Infusion). The drawer is hidden on home.
- Background: deep dark `#0c0e17` ink with two faint radial glows (purple top-left, cyan top-right) and a 44 × 44 px ghost grid overlay.
- A **pointer aura** soft glow follows the mouse on fine-pointer devices (skipped on touch / reduced motion).
- Max content width: **104rem** (1664px). Horizontal padding: 16px (mobile) → 24px (≥sm).

### 4.2 Header (`AppHeader`)

- Brand area (left): 44×44 logo tile (`/android-chrome-192x192.png`) + wordmark (`/assets/brand/enjinsight_brand.png`). Click → home. A small cyan dot pulses on the logo while a scan is loading.
- Action icons (right, hidden < sm): **README** (external link to GitHub README), **About** (opens about modal), **GitHub** (external link to repo).
- Hamburger (visible < lg) toggles a vertical drawer with all nav items + the same external links.
- Nav pill row (visible ≥ lg) — six items in this exact order:
  1. Home (`home`)
  2. Era Explorer (`era`)
  3. Staking Cadence (`staking`)
  4. Balance Viewer (`balance`)
  5. Reward History (`reward-history`)
  6. ENJ Infusion (`infusion`)
- Active pill uses primary tint with `aria-current="page"`.
- While a scan is running, navigation **must block** (clicking a nav item during `status === 'loading'` is a no-op). Switching off the staking view while a scan is in-flight resets the staking hook.

### 4.3 Footer (none)

The app has no traditional footer. The terminal log drawer occupies the bottom region.

### 4.4 First-visit disclaimer (modal)

- Fires the first time the user loads the app (key `enjinsight_disclaimer_v1` in `localStorage`).
- Backdrop is **non-dismissible** (no click-outside, no Escape).
- Primary button reads "I understand (5)" and counts down 5 → 4 → 3 → 2 → 1 → enabled.
- Body must include: an "EnjinSight is unofficial third-party tooling…" warning panel, plus three info cards: **Read-only**, **Public data**, **Verify**.

### 4.5 About modal

- Triggered from the header "About" button.
- Same body content as the first-visit modal, but: dismissible by Escape, click-outside, and a Close button. Shows the brand mark at the top.

---

## 5. Landing Page (`view === 'home'`)

- Top: a single short paragraph: *"Read-only monitoring utilities for the Enjin ecosystem…"* (full copy in §13.1).
- Section heading: **"Toolset"**.
- Card grid of all five tools: 1 column (mobile) → 2 columns (md) → **5 columns (xl)**.
- Each card (≥ 19rem min height) shows:
  - A 44×44 rounded icon tile (Lucide icons in the table below) tinted with `accent`.
  - The tool title (Space Grotesk, bold).
  - A short *"Source: …"* line (text-secondary, 12px).
  - A 2-3 sentence description.
  - A **single secondary button** centered at the bottom whose label is fixed per tool.
- Cards lift on hover (`-translate-y-1`) and tint the border cyan.

| Card key | Icon | Title | Resource | Button label | Accent class |
|----------|------|-------|----------|--------------|--------------|
| `era` | `Layers` | Era Block Explorer | Relaychain RPC Endpoint | Launch Explorer | `text-primary` |
| `staking` | `BarChart3` | Staking Rewards Cadence | Subscan API Endpoint | View Cadence | `text-cyan` |
| `balance` | `LineChart` | Historical Balance Viewer | Archive RPC Endpoint | Track Address | `text-warning` |
| `reward-history` | `TrendingUp` | Reward History Viewer | Archive RPC + Subscan | Audit History | `text-success` |
| `infusion` | `Gem` | ENJ Infusion Checker | Ethereum RPC + Etherscan | Check Infusion | `text-primary` |

---

## 6. Sticky Terminal Log (every tool view)

A glass panel fixed to the bottom of the viewport.

- Header bar (always visible): a 40×40 terminal icon tile, **"LOGS"** kicker, a green pulse dot, "Activity Stream" subtitle, the latest log line preview (≥ lg), a "{N} lines" pill, and a chevron toggle.
- Click / keyboard (Enter / Space) on header expands the body.
- Expanded body (max-height `min(320px, 42dvh)`): one row per log entry with three columns:
  - **timestamp** (HH:MM:SS, muted)
  - **level** in brackets, colored (`INFO` cyan, `OK` success-green, `WARN` warning-amber, `ERR` danger-red, `DONE` primary-purple)
  - **message** (text)
- Lines containing `Retry N/M` render the message in yellow-bold.
- Empty state: italic "No output yet." in muted text.
- The drawer's height must be reflected in `document.body.paddingBottom` so other content is never hidden.
- Logs are **append-only**, **capped at 500 entries** (Era Explorer caps at 200). New lines auto-scroll into view if the body is already at the bottom.

---

## 7. Tool 1 — Era Block Explorer (`view === 'era'`)

### 7.1 Purpose

Real-time view of Enjin Relaychain era / session / block plus instant historical era lookup.

### 7.2 Page layout (top → bottom, two-column at xl)

**Left column (≈1.52fr):**

1. **Page hero** with a status kicker ("Active Blockchain State") and a status dot whose color matches connection state.
2. **Live state grid** — six metric cards, in this order:
   - Active Era
   - Session
   - Current Block
   - Era Starts (block #)
   - Era Ends (block #)
   - Blocks Left (remaining)
   Plus two side cards: **Relaychain · Live** (primary tint), **Cached Eras · {csvCount}** (cyan tint).
3. **System Heartbeat** card — animated EKG SVG path that re-triggers a full-width pulse on every new block (color = cyan when live, muted when not). 128×32 monitor.
4. **Era Progress** card — full-width progress bar `bg-gradient-to-r from-primary-dim via-primary to-cyan`, with a large mono percentage in the header.
5. **Debug** collapsible terminal panel (default closed). When open, shows in a 2-column grid: status, latest block, era start, era end, remaining, percent, era key (full hex, single line), pallet method names, csv hit count, raw RPC response keys.

**Right column (≈0.48fr):**

6. **Past Era Lookup** panel:
   - Title: "Past Era Lookup".
   - A status pill: green "Ready · {csvCount} eras" once the CSV is parsed; amber "Loading" while it's loading.
   - A two-button toggle in the panel header: **UTC** ↔ **Local** (active state highlighted cyan with `aria-pressed`).
   - A form: a numeric **Era number** input (`type="number"`, `min=0`, `step=1`) plus a **"Look Up"** primary button. The button shows "Searching…" with a pulse during lookup.
   - Inline validation: "Era must be a non-negative integer", "Era cannot exceed current era ({era})".
   - Result card (after a successful lookup) shows: target era, start block, end block, start hash (truncated, with copy button — copied state shows "Copied" briefly), start datetime in UTC or local depending on toggle, end datetime, source label (`csv` / `archive` / `binary-search`).
   - Error result card uses danger tint.

### 7.3 Connection states

`status` ∈ `idle | connecting | discovering | live | disconnected`. Each state has its own dot color and label:

| Status | Dot color | Label |
|--------|-----------|-------|
| idle | muted | Idle |
| connecting | cyan, pulsing | Connecting |
| discovering | cyan, pulsing | Syncing |
| live | success | Live |
| disconnected | warning, pulsing | Reconnecting |

### 7.4 Behavior

- On mount: open WS to `wss://rpc.relay.blockchain.enjin.io`, fetch CSV, then bind `chain_subscribeFinalizedHeads`.
- On every new finalized block: increment `block`, recompute `pct`, call the registered `beatCallback` (which retriggers the EKG animation via `pulseKey`).
- 12-second polling acts as keepalive (re-queries chain head, era, session).
- 30-second stale detection: if no new block arrives, force a reconnect.
- Auto-reconnect: 5-second backoff after WS close.
- Lookup resolves via three sources, in order: CSV → live RPC `Staking.ErasStartSessionIndex` → archive-node binary search.

### 7.5 No buttons not listed

The Era Explorer has only the following interactive elements: Era number input, "Look Up", UTC/Local toggle, Debug panel toggle, copy-hash button, Era Progress copy of percent (text only, not a button), nav header buttons, terminal-log expand, and (within other modals) close/dismiss. Nothing else.

---

## 8. Tool 2 — Staking Rewards Cadence (`view === 'staking'`)

### 8.1 Purpose

Scan all active validators **or** all nomination pools for missing reward payouts across the last *N* eras and surface severity.

### 8.2 Page layout

1. **Hero** — kicker "STAKING DIAGNOSTICS" + headline "Staking rewards cadence with live operator context." + subhead.
2. A 3-column grid (collapses to stacked on smaller screens):
   - **Mode selector** (`<ModeSelector>`): two large radio cards stacked vertically at xl, side-by-side at sm:
     - **Validators** (`Shield` icon) — "Scan active validators, nominators, and era reward gaps."
     - **Nomination Pools** (`Users` icon) — "Scan pool payouts, validator participation, and missed eras."
     - The active card has primary border + primary glow, plus a small "Selected" chip.
   - **Cadence Controls** (`<ControlPanel>`):
     - Title: "Cadence Controls", helper "Set how many recent eras to check."
     - Helpful meta: "Range: 1–100 eras", "Approximate Length: 1 era ≈ 24h".
     - A single **giant numeric input** (Space Grotesk 4xl) labelled "Scan Range (Eras)". Default `2`. Validation: integer 1–100. If > 30, show amber warning "Longer range selected. Expect a slower scan."
     - One large **action button** that morphs by status:
       - `idle` / `loading=false`: **Run Scan** (primary, glowing border, "staking-scan-button" hover animation).
       - `loading`: **Stop Scan** (danger, square icon).
       - `done` / `stopped` / `error`: **Reset View** (secondary).
     - Pressing Enter inside the input triggers the action.
   - **Phase Progress** (`<PhaseProgressCards>`): a card grid where each phase is a 64×64 ring-progress with status label.

3. **Validator panel** (when mode = validators and ≥1 validator returned): collapsible "Results · Validators" header showing:
   - "{X} / {Y} loaded" while loading.
   - "{N} validators scanned" pill.
   - Pagination if > 10.
   - Body: 2-column (lg) / 4-column (2xl) grid of `<ValidatorCard>`s — see §8.4.
   - Followed by `<SummarySection>` once `status === 'done'`.

4. **Pool panel** (when mode = pools and ≥1 pool returned): same structure as validator panel, using `<PoolCard>` and `<PoolSummarySection>`.

5. **Empty state** ("Ready to Scan") shows a stylized EKG-cross icon + "Choose a mode, set how many recent eras to check, then run the scan…".

6. **Error state** ("Failed to fetch validator/pool list") with a "Retry Scan" button.

### 8.3 Phases

Validator scan phases (in order):

| key | Label |
|-----|-------|
| `probe` | Check API Endpoints |
| `list` | Fetch Validators |
| `nominators` | Fetch Nominators |
| `eras` | Fetch Era Stats |

Pool scan phases:

| key | Label |
|-----|-------|
| `probe` | Check API Endpoints |
| `list` | Fetch Pools |
| `validators` | Fetch Nominated Validators |
| `ranges` | Resolve Era Ranges |
| `rewards` | Confirm Rewards |

Phase status is one of `pending`, `in_progress`, `completed`. The PhaseProgressCards component renders:

- pending: muted circle with `…`, label "Queued".
- in_progress: cyan ring + percentage in the center, label "Running".
- completed: green ring + checkmark, label "Complete".

### 8.4 ValidatorCard

Card body (clickable; opens detail modal):

- Icon tile: `Shield` (active validator) or `Clock` (waiting) or `Loader` (loading).
- Validator display name + truncated SS58 address (`8…6` chars).
- Two action icon buttons in the top-right: **Copy address** (clipboard, with "copied" toast text), **Subscan link** (external).
- Three metric rows: **Commission %**, **Bonded ENJ** (4-decimal, with "ENJ" suffix), **Nominators**.
- Status footer with severity badge (none / low / medium / high) and a "View Details" affordance.

ValidatorCard detail modal:

- Header: name + truncated address + status, copy + Subscan + close buttons.
- Four preview metrics: Commission, Bonded, Nominators, Reward Gaps.
- Two tabs:
  - **Era Rewards** (badge shows missed-era count or total era count). Tab body: `<EraStatTable>` with columns Era / Start Block / End Block / Reward Point / Blocks Produced. Page sizes 5/10/20/50. Missed eras render as a red row spanning the data columns saying "— No era stat recorded —".
  - **Nominators** (badge shows count). Tab body: `<NominatorsTable>` with columns # / Address (mono, truncated, copy) / Display Name / Bonded. Page sizes 5/10/20/50.

### 8.5 PoolCard

Card body (clickable):

- Mono `#poolId` badge + state badge: **Open** / **Blocked** / **Destroying**.
- Pool name (from metadata) — `poolLabel(pool)` returns `{stashDisplay} — {metadata}` if metadata is set, else `Pool #{id}` / stash display.
- Action icons: copy stash address, Subscan pool link.
- Three metric rows: **Members**, **Validators**, **Bonded ENJ**.
- Severity badge in footer.

PoolCard detail modal:

- Same shell as ValidatorCard.
- Four preview metrics: Members, Validators, Bonded, Commission %.
- Two tabs:
  - **Era Rewards**. Tab body: `<PoolRewardTable>` with columns Era / Reward (ENJ) / Rewarded (count) / No Reward (count) / Status (CheckCircle "Rewarded" or XCircle "No Reward"). The columns *Rewarded* and *No Reward* are hidden < md. Each row is expandable (chevron) to show two nested lists when breakdown data exists:
    - **Rewarded validators**: address (truncated, copy + Subscan link) + reward share.
    - **Unrewarded but active**: address only.
    - **Inactive validators**: greyed.
    Missed eras render with danger tint and XCircle status.
  - **Validators** (`<PoolValidatorsTable>`): columns # / Address (copy + Subscan) / Display Name / Bonded / Status (Active / Inactive badge, "Queued" indicator, retry button on failure).

### 8.6 SummarySection (validators)

After `status === 'done'`. Top row of three stat chips: **Total Scanned**, **Clean Record** (success), **Has Gaps** (danger or success).

If any group has `≥ CONSECUTIVE_MISS_THRESHOLD = 3` consecutive misses, show **Critical Alerts** — one card per affected validator with severity, validator label, and a Subscan link.

Then a **Validators with gaps** table (paginated 5/10/20). Desktop columns: Validator / Checked / Rewarded / Missed / Missing Eras (first 6, truncated with "…") / Severity badge. Mobile = card per row.

A green "all rewarded" banner when nobody missed.

A **Clean validators** collapsible (closed by default) with a preview-chip strip and the full grid when expanded.

### 8.7 PoolSummarySection

Same shape as SummarySection but with pool-flavored copy and one extra column on the gaps table — **Reason** (e.g., "No active nominees", "Pool inactive at era N", "No reward events recorded"). Pool gap rows are clickable; clicking highlights the pool in the panel grid (jumps to the right page).

### 8.8 Severity colors

| Missed count | Severity key | Class |
|--------------|--------------|-------|
| 0 | none | (none) |
| 1–2 | low | `sev-low` (amber/warning) |
| 3–5 | medium | `sev-medium` (orange) |
| 6+ | high | `sev-high` (danger) |

---

## 9. Tool 3 — Historical Balance Viewer (`view === 'balance'`)

### 9.1 Purpose

Query and visualize any wallet's free / reserved / frozen balances over a block, era, or date range — directly from an Enjin archive node.

### 9.2 Page layout

1. **Hero** with two large tab buttons in a pill container: **Query Node** | **Import Data**.
2. **Query pane** (3-column grid at xl):
   - Col 1: **Scan Configuration** — network selector + address input + range parameter card (varies).
   - Col 2: **Live chain snapshot** (two metric cards), **Range Mode** picker, action buttons, error banner.
   - Col 3: **Phase Progress** card.
3. **Import pane** — file dropzone or, if data was just imported, the same results view as a query.
4. **Results section** (any time records exist or are streaming):
   - Records summary bar (Wallet / Records / Block Range / Format).
   - **Balance chart** (`<BalanceChart>`) — see §9.4.
   - **Smart Insights**: two metric cards — Max Free Balance, Balance Utilization %.
   - **Balance table** (`<BalanceTable>`) — see §9.5.
   - **Export panel** (only for query-sourced data).

### 9.3 Inputs

#### Network dropdown (presets only, no custom URL field unless `custom`):

| key | Label | Endpoint | SS58 prefix | Date range supported? |
|-----|-------|----------|-------------|------------------------|
| `matrixchain` | Enjin Matrixchain | `wss://archive.matrix.blockchain.enjin.io` | 1110 (`ef…`) | no |
| `relaychain` | Enjin Relaychain | `wss://archive.relay.blockchain.enjin.io` | 2135 (`en…`) | yes (`/relay-era-reference.csv`) |
| `canary-matrix` | Canary Matrixchain | `wss://archive.matrix.canary.enjin.io` | 9030 (`cx…`) | no |
| `canary-relay` | Canary Relaychain | `wss://archive.relay.canary.enjin.io` | 69 (`cn…`) | yes (`/canary-relay-era-reference.csv`) |
| `custom` | Custom endpoint… | (user-typed wss:// URL) | (none) | no |

The address input enforces the SS58 prefix when known; mismatch shows a danger note "Address prefix '…' does not match …". Address max 64 chars.

#### Range mode (radio cards):

- **Block range**: Start Block / End Block / Step (Blocks). All `type=number`. Step ≥ 1, default 14400. The range cannot exceed `MAX_RPC_CALLS = 2000` blocks.
- **Era range** (only if the network supports a CSV — relay or canary-relay): Start Era / End Era / Step (Eras). Step default 1.
- **Date range** (CSV networks only): Start Date / End Date (HTML5 `type=date`, max=today) / Step (Days, 1–999). Plus a row of **Quick presets**: 1 day, 1 week, 1 month, 3 months, 6 months, 1 year. Active preset is highlighted; manually editing dates clears the preset highlight.

#### Live chain snapshot card:

- "Live Era · {era}" and "Live Block · {block}". Shows "…" while loading. Sourced from `chainInfo.js` (one-shot WS query on view mount).

### 9.4 Action buttons

- **Fetch Balance** — primary, full-width-friendly. Disabled if any input is invalid. Becomes **Stop** (danger) while `status === 'querying'`. Becomes **Reset** (secondary) once `status === 'done' | 'cancelled' | 'error'`.
- The pane shows real-time progress: 3 phases — `connect` (Connect, total=1), `query` (Query Balance Snapshots, total = block count), `finalize` (Assemble Records, total=1).

### 9.5 BalanceChart

Modes (button row, single-select):

1. **Total** — stacked bar of all four fields per block.
2. **Free**
3. **Reserved**
4. **Misc Frozen**
5. **Fee Frozen**

Modes 2-5 render as a single line with a 10%-opacity gradient fill below.

Field colors (must remain identical for color-blind/AA contrast):

| Field key | Label | Stroke | Fill |
|-----------|-------|--------|------|
| `free` | Free | `#00d9ff` | `rgba(0,217,255,.65)` |
| `reserved` | Reserved | `#ffc400` | `rgba(255,196,0,.65)` |
| `miscFrozen` | Misc Frozen | `#ff7a35` | `rgba(255,122,53,.65)` |
| `feeFrozen` | Fee Frozen | `#ff2d78` | `rgba(255,45,120,.65)` |

Other chart controls:

- **Zoom**: − / `{percent}` / + / ⊙ reset. Range 60% – 200%, step 10%, default 100%. Animates the chart frame's height.
- **Decimation**: never plot more than `CHART_MAX_PTS = 250` points; show a small badge `~{n} sampled of {total}` when sampling is active.
- **Custom tooltip**: dark glass with block number title, all four fields colored, block hash footer (truncated, mono), smart left/right edge flip.
- **Crosshair**: dashed cyan vertical line + dot on hover.
- **Stroke width**: 2px.

### 9.6 BalanceTable

Columns (sortable headers with ↑ / ↓ / ↕ icon, `aria-sort`):

| Column | Type | Notes |
|--------|------|-------|
| Block | int | left, mono, locale-formatted |
| Hash | string | mono, truncated 10+8 chars; `title` attribute = full hash |
| Free | BigInt → ENJ | right, cyan, 4-decimal |
| Reserved | BigInt → ENJ | right, gold, 4-decimal |
| Misc Frozen | BigInt → ENJ | right, orange. If row is `newFormat`, the cell shows the special label "frozen" |
| Fee Frozen | BigInt → ENJ | right, pink. If row is `newFormat`, shows "n/a" |

Controls:

- **Page size selector**: 10 / 25 / 50 / 100 / 250 (resets to page 1 on change).
- **Text size zoom**: − / S / M / L / ⊙ (3 sizes: `text-xs`, `text-sm`, `text-base`).
- **Pagination**: First « / Prev ‹ / page pills (up to 5 around current) / Next › / Last ».
- **Sticky header** with surface-high background.
- **Alternating row backgrounds**.
- Empty: "No records yet." or "Fetching balance data…" centered.
- While `status === 'querying'`, table is shown with a "Populating…" indicator and rows stream in as they resolve.

### 9.7 Export panel (only for query-sourced data)

- **Encrypt** toggle (lock/unlock icon) — when on, requires a password (`type=password`, max 1024 chars).
- **Filename** field (max 200 chars; default `balance-history-{address}-{date}`). Sanitized by `safeFilename()`.
- **Format** dropdown: `JSON` / `CSV` / `XML`.
- **Export** primary button (disabled if no records or processing). On success/error shows colored banner.
- Implementation: AES-256-GCM with PBKDF2-SHA-256, **100 000 iterations**, random 16-byte salt and 12-byte IV. The encrypted file shape is `{ encrypted: true, algorithm, kdf, data: <base64> }`.

### 9.8 Import panel

- A drag-and-drop zone (also click to pick a file). Accepts `.json`, `.csv`, `.xml`. Max 10 MB.
- Shows file status card: filename, extension badge, size, status icon, rejection reason.
- Encrypted files prompt for password and show a **Decrypt & Import** primary button.
- After successful import, **stays on the Import tab** but renders the same results section (chart, smart insights, table). Export panel is **not** shown for imported data.

### 9.9 Status state machine

`status` ∈ `idle | connecting | querying | done | cancelled | error`. The "Reset" button always returns to `idle`.

---

## 10. Tool 4 — Reward History Viewer (`view === 'reward-history'`)

### 10.1 Purpose

Compute per-era staking-pool rewards for one Enjin Relaychain address (prefix `en…`) by reading sENJ balances at era-start blocks and Subscan reward events. Mirrors `scripts/staking-rewards-rpc.py`.

### 10.2 Page layout (mirrors Balance Viewer in shape)

1. **Hero** with tab pills: **Compute** | **Import**.
2. **Compute pane**:
   - Disclaimer card: "Reward history is an estimate" — links to `docs/reward-history-computation.md`.
   - **RPC Configuration**: address input only; the archive endpoint is fixed (`wss://archive.relay.blockchain.enjin.io`, displayed as read-only meta).
   - **Range mode** (two cards): **Era range** | **Date range**.
     - Era range: Start Era / End Era inputs.
     - Date range: Start Date / End Date inputs + presets **1 week**, **1 month**, **3 months**, **6 months**, **1 year**.
   - Optional toggle: "Include past pool interactions" (when on, also scans historic Subscan extrinsics for past pool IDs).
   - **Run Reward Scan** primary button. Becomes **Stop** while loading; "Reset View" after.
   - **Phase progress** card.
3. **Results** (when results exist or are streaming):
   - **Reward Growth** chart card (line chart, one series per pool — colors cycle through a deterministic palette).
   - **My Bonded ENJ by Pool** chart.
   - **Reward ENJ by Pool** chart.
   - **Ledger Data** table (see §10.3).
   - **Reward Overview** stats card: total reward (ENJ), avg APY, era range, eras with reward, pool count, best APY era, best pool.
   - **Save reward dataset** export panel (same encryption + format options as Balance Export — JSON / CSV / XML).
4. **Import pane** — same dropzone behavior as Balance Import, with optional decryption and identical result rendering on the Import tab.

### 10.3 Ledger Data table — columns

| Key | Header | Align | Sortable |
|-----|--------|-------|----------|
| `era` | Era | left | yes |
| `eraDate` | Date | left | yes |
| `poolId` | Pool ID | left | yes |
| `poolName` | Pool Name | left | yes |
| `memberBalance` | Member sENJ | right | yes |
| `reinvested` | Reinvested ENJ | right | yes |
| `reward` | Reward ENJ | right | yes |
| `accumulated` | Cumulative ENJ | right | yes |
| `apy` | APY* | right | yes |
| `rollingApy` | APY 15d* | right | yes |

Toolbar:

- **Pool filter** dropdown: "All pools" + one option per encountered pool.
- **Era min / Era max** numeric inputs.
- **Page size**: 10 / 25 / 50 / 100.
- The chart above the table reacts to the current filter (chart series is filtered).

### 10.4 Phases

1. Load Era Reference (CSV)
2. Fetch Pool Names (Subscan)
3. Connect to Archive Node
4. Discover Pool Membership (sENJ balance check at current head)
5. *(optional)* Fetch Past Pool Interactions
6. Query Era Balances (member sENJ + pool total at each era start block)
7. Fetch Reinvested Amounts (scan `NominationPools` chain events over the archive RPC in the
   41-block window after the era boundary; net of operator commission)

### 10.5 Algorithm (do not change formula)

```
pool_reinvested_ENJ       = EraRewardsProcessed.reinvested          (pre-v1060 eras)
                          | Σ max(reward − commission, 0)           (v1060+ eras, RewardPaid)
reward_per_era[pool, era] = (member_sENJ / pool_total_sENJ) × pool_reinvested_ENJ
APY                       = ((pool_activeStake + reinvested) / pool_activeStake)^365 − 1
APY_15d                   = same ratio compounded over a sliding 15-era window
```

**Commission must be SUBTRACTED, never added.** `RewardPaid.reward` is the gross figure; only
`reward − commission` compounds into the pool. Use `netReinvested()` from
`src/utils/rewardMath.js` — do not re-implement it inline. Adding commission instead overstates
every figure by `2 × commission` (~+15% at a 7% rate); this was a real defect, documented in
`docs/nomination_pool_reward_accounting_fix.md`.

The APY denominator is the pool's bonded `activeStake` (unit-matched with `reinvested`), falling
back to `pool_total_sENJ` only when the staking-ledger read fails. The redesign must keep the
asterisk on the "APY*" header and the disclaimer card.

### 10.6 Storage keys (must remain)

- `MultiTokens.TokenAccounts(collectionId=1, tokenId=poolId, address)` → first u128 field is **member sENJ balance**, **SCALE compact-encoded** (use `decodeCompactFirst` from `src/utils/substrate.js`).
- `MultiTokens.Tokens(collectionId=1, tokenId=poolId)` → first u128 field is **pool total sENJ supply**, also SCALE compact-encoded.

---

## 11. Tool 5 — ENJ Infusion Checker (`view === 'infusion'`)

### 11.1 Purpose

Read ERC-20 ENJ infusion values for Ethereum ERC-1155 token IDs from contract `0xfaafdc07907ff5120a76b34b731b278c38d6043c`. Two modes: single Token ID or full Wallet scan.

### 11.2 Page layout

1. **Hero** + four info cards: contract address (with copy + Etherscan link), RPC endpoint, scope ("Mainnet ENJ"), wallet-scan-incomplete note.
2. **Scan card** with a pill-tab toggle in its header: **Token ID** | **Wallet**.
3. **Single mode form**: one text input "Enter token ID or Etherscan NFT URL" + **Check** primary submit.
4. **Wallet mode form**: one text input "Enter Ethereum wallet address" (validated as `0x` + 40 hex chars) + **Bulk Check** primary submit.
5. **Infusion value panel** (single mode): label + formatted ENJ value + raw hex value + "Database" data-source pill.
6. **Phase Progress** card on the right (3 phases for either mode).
7. **Wallet results section** (after a bulk scan starts):
   - Status bar ("Checked X of Y", "Y failed", etc.).
   - Toolbar: search (`type=search`, "Filter wallet results"), page size dropdown (10 / 25 / 50), **Retry All Failed** secondary button.
   - **Bulk results table** (see §11.4).
   - **Pagination** (« / ‹ / pills / › / »).

### 11.3 Phases

| Step | Single mode | Bulk mode |
|------|-------------|-----------|
| 0 | Validate token | Fetch wallet tokens |
| 1 | Read infusion (`typeData(uint256)`) | Read infusions (loop) |
| 2 | Review result | Review results |

### 11.4 Bulk results table — columns

1. **Token ID** (mono)
2. **Preview Image** — the ERC-1155 image, loaded from the token URI; placeholder SVG (`/nft-placeholder.svg`) if missing or while loading.
3. **Token Name**
4. **Amount (ENJ)** — formatted, 4-decimal
5. **Raw Value** — hex
6. **More Details** — opens a `<DetailModal>` with full metadata.

All columns sortable except Preview Image. Failed rows render with `data-table-row-danger` background and a red "Failed" label + per-row **Retry** button.

### 11.5 Detail modal contents

For one token: contract, owner (this wallet, or "—"), creator, token standard ("ERC-1155"), quantity owned, name, image (full size), description, properties grid (key/value pairs from URI metadata), and an Etherscan link.

### 11.6 RPC fallback chain

1. Try same-origin `/api/eth-call` (Alchemy server-side if configured, else Etherscan `proxy/eth_call`). Server returns `X-RPC-Provider` header → log "via Alchemy" / "via Etherscan".
2. If same-origin fails, fall back to a small list of public Ethereum RPC endpoints from the browser.
3. Per-token retries: up to **5** attempts with exponential backoff + jitter.

---

## 12. Cross-cutting UI inventory

### 12.1 Modals

| Modal | Where it opens from | Dismiss |
|-------|---------------------|---------|
| First-visit disclaimer | First load (localStorage) | Button only, after 5s countdown |
| About | Header → About | Esc, click outside, Close button |
| Validator detail | Click `<ValidatorCard>` | Esc, click outside, Close, scroll-locked body |
| Pool detail | Click `<PoolCard>` | Same |
| Token detail | Bulk row "More details" | Same |

All modals use `role="dialog"`, `aria-modal="true"`, lock body scroll while open.

### 12.2 Toasts / micro-feedback

- Copy buttons flip to "Copied" text (or a check icon) for ~1.5s, then revert.
- Export success/failure shows an inline alert banner inside the export panel, not a global toast.
- There is no global toast system; all feedback is inline.

### 12.3 Buttons

| Class name | Style |
|------------|-------|
| `.btn-primary` | Linear gradient `primary-dim → primary`, white text, drop shadow. Active scale 0.97. |
| `.btn-secondary` | `surface-highest` fill, ghost border. |
| `.btn-stop` / `.btn-danger` | Red gradient. |
| `.btn-ghost` | Transparent, hover surface-bright. |
| `.btn-icon` | 38×38 ghost square, used for header chrome. |
| `.staking-scan-button` | Variant of primary with a hover-glow keyframe animation. |

### 12.4 Inputs

| Class | Use |
|-------|-----|
| `.input-field` | Standard text/number/date input (px-3 py-2.5, surface-highest). |
| `.select-field` | Standard select. |
| `.select-compact` | Small select for table toolbars. |
| `.input-label` | 10px uppercase tracked label above an input. |

### 12.5 Pagination

A single pattern, used in three places (validators, pools, bulk infusion table):

`« First | ‹ Prev | {page} / {totalPages} | Next › | Last »`

Each button is a `.btn-ghost`; disabled buttons get `opacity-30`.

### 12.6 Address & ENJ display

- Truncate addresses as `firstN…lastM` (default 8 + 6).
- Always display ENJ as `{whole-with-commas}.{4-decimals} ENJ`. Never use floats; always go through `formatENJ(BigInt)`.
- Subscan validator URL: `https://enjin.subscan.io/validator/{address}`.
- Subscan pool URL: `https://enjin.subscan.io/nomination_pool/{poolId}`.
- For ERC-1155: Etherscan token URL `https://etherscan.io/token/{contract}?a={tokenId}`.

### 12.7 Severity / status badge classes

| Class | Style |
|-------|-------|
| `.badge-active` | success border + tint, "ACTIVE" |
| `.badge-waiting` | muted border, "WAITING" |
| `.badge-error` | danger border + tint, "ERROR" |
| `.sev-low` | warning amber |
| `.sev-medium` | orange |
| `.sev-high` | danger red |

### 12.8 Empty / error / loading patterns

Every tool has all three:

- **Empty / pre-action**: a centered card with an icon, headline, sentence-long description, optional button.
- **Loading**: phase progress cards + sticky terminal log + per-section "loading…" labels (e.g., "Populating…", "Fetching balance data…").
- **Error**: a danger banner with a one-line message + a "Retry" button.

### 12.9 Keyboard

- Enter inside any single-input form triggers the matching action.
- Escape closes any non-blocking modal.
- Tab order follows visual order; every interactive control has a visible `:focus-visible` outline.

### 12.10 Responsive breakpoints

Match Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536.

Key responsive rules:

- Header pill row hides below `lg` and is replaced by a hamburger drawer.
- Validator/pool grid: 1 col → 2 col @ `lg` → 4 col @ `2xl`.
- Landing toolset grid: 1 col → 2 col @ `md` → 5 col @ `xl`.
- Era explorer two-column layout collapses below `xl`.
- Several table columns hide below `md` (Bonded, Reward Point, Rewarded count, etc.).

---

## 13. Copy bank (use exactly, or only stylistic edits)

### 13.1 Landing intro

> Read-only monitoring utilities for the Enjin ecosystem, designed to make dense on-chain data feel legible. Jump straight into era tracking, staking diagnostics, balance archaeology, reward audits, or ERC-20 ENJ infusion checks.

### 13.2 First-visit / About body

> EnjinSight is unofficial third-party tooling and is not developed by or affiliated with the Enjin development team. The information shown here is assembled from public chain data and should be treated as a research aid, not a guarantee. Verify important operational, accounting, or tax decisions against your own records.

### 13.3 Era hero

> Active Blockchain State

### 13.4 Staking hero

- Kicker: `STAKING DIAGNOSTICS`
- Headline: `Staking rewards cadence with live operator context.`
- Subhead: `Scan validator or pool reward cadence, then inspect the raw detail tables below without burning space on duplicate summary blocks.`

### 13.5 Reward History headline

> Pool reward history with export-ready structure.

### 13.6 Infusion hero

> ERC-20 ENJ infusion lookup.

---

## 14. Design tokens (current — replace freely)

The redesign may rebuild the whole token system, but the redesign **must** maintain WCAG AA contrast, the same semantic categories below, and identical chart-field colors (§9.5).

### 14.1 Surface hierarchy ("no-line rule")

| Token | Hex | Use |
|-------|-----|-----|
| `ink` | `#0c0e17` | App background |
| `surface` | `#11131d` | Page sections |
| `card` | `#171924` | Component surfaces |
| `surface-high` | `#1c1f2b` | Headers / hover |
| `surface-highest` | `#222532` | Inputs / interactive surfaces |
| `surface-bright` | `#282b3a` | Active hover |
| `term` | `#000000` | Terminal log background |

### 14.2 Brand / signal

| Token | Hex |
|-------|-----|
| `primary` | `#b6a0ff` |
| `primary-dim` | `#8051ff` |
| `primary-glow` | `#aa8fff` |
| `cyan` | `#00eefc` |
| `cyan-dim` | `#00deec` |
| `success` | `#8eff71` |
| `success-dim` | `#2be800` |
| `warning` | `#F59E0B` |
| `danger` | `#ff6e84` |
| `danger-dim` | `#d73357` |

### 14.3 Text / borders

| Token | Hex |
|-------|-----|
| `text` | `#f0f0fd` |
| `text-secondary` / `dim` | `#aaaab7` |
| `muted` | `#737580` |
| `border` (rim) | `#464752` (used at 8–16 % opacity) |

### 14.4 Typography (replaceable)

- Display / Headlines: **Space Grotesk** 300–700.
- Body / UI: **Inter** 300–700.
- Mono: system mono stack (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`).

Reusable headline scales:

- `hero-title` — `clamp(1.55rem, 2.45vw, 2.45rem)`, line-height 1.05, balanced wrap.
- `section-title` — 1.25rem → 1.7rem at `sm`.
- `section-label` — 10px bold uppercase, tracking 0.24em, `text-secondary`.
- `metric-value` — `clamp(1.3rem, 1.95vw, 2.15rem)`, mono headline.
- `metric-label` — 10px uppercase, tracking 0.24em.

### 14.5 Radii

- Cards: `1.1rem` – `1.35rem`.
- Pills / badges: full.
- Buttons: `lg` (0.5rem).
- Hero: `1.6rem`.

### 14.6 Shadows

- `card`: `0 4px 24px rgba(0,0,0,0.3)`
- `ambient`: `0 24px 64px rgba(5, 8, 18, 0.45)`
- `primary-glow`: `0 0 20px rgba(182,160,255,0.25)`
- `cyan-glow`: `0 0 20px rgba(0,238,252,0.15)`
- `inset-soft`: `inset 0 1px 0 rgba(255,255,255,0.04)`

### 14.7 Animations

- `pulse-slow` (3s cubic-bezier loop)
- `fade-in` (0.3s, opacity + 4px Y)
- `slide-down` (0.25s, opacity + max-height 0 → 2000px)
- `blink` (1.2s step-end)
- `heartbeat-burst` — single 2s SVG dash burst on each new block (Era Explorer)
- `staking-scan-hover-glow` — alternating 1.7s glow when hovering "Run Scan"

---

## 15. Hooks and state contracts (binding surface for the new UI)

The new UI must bind to the same hooks. **Do not change the hook signatures or status state machines.** Each hook lives in `src/hooks/`.

### 15.1 `useEraExplorer()`

Exposes:

- `status: 'idle' | 'connecting' | 'discovering' | 'live' | 'disconnected'`
- `era`, `session`, `block`, `eraStart`, `eraStartMethod`, `csvCount` (numbers)
- `lookup` — `null | { era, startBlock, endBlock, source: 'csv' | 'archive' | 'binary-search', startDateUtc, endDateUtc, startBlockHash }`
- `lookupLoading`, `lookupError` (string)
- `logs[]`
- `debug` — full pallet/method/raw debug payload
- Methods: `lookupEra(eraNumber)`, `resetLookup()`, `setBeatCallback(fn)`

### 15.2 `useBalanceExplorer()`

Statuses: `idle | connecting | querying | done | cancelled | error`. Exposes `records[]` (BigInt fields), `progress` (3 phases), `dataSource: 'none' | 'query' | 'import'`, `errorMsg`, `logs[]`.

Methods: `runQuery({ endpoint, address, startBlock, endBlock, step })`, `cancel()`, `reset()`, `importData(text, ext, fname)`, `importEncrypted(encText, password, ext, fname)`.

Record shape: `{ block, blockHash, free, reserved, miscFrozen, feeFrozen, nonce, newFormat }` — balances are BigInt Planck.

### 15.3 `useRewardHistory()`

Statuses: `idle | loading | done | stopped | error`. Exposes `results[]`, `progress` (phases listed in §10.4), `csvCount`, `logs[]`.

Methods: `run({ address, startEra, endEra, endpoint, includeHistory })`, `stop()`, `reset()`, plus the import counterparts.

Result shape: `{ era, poolId, poolLabel, memberBalance, poolSupply, activeStake, reinvested, reward, accumulated, apy, eraStartBlock, eraStartDateUtc, rollingApy }`.

### 15.4 `useValidatorChecker()`

Statuses: `idle | loading | done | stopped | error`. Exposes `validators[]`, `progress` (4 phases listed in §8.3), `logs[]`, `proxyUrl` (reserved, no-op).

Methods: `runCheck(eraCount)`, `stop()`, `reset()`, `retryValidator(address)`, `setProxy(url)` (no-op).

Validator shape: `{ address, display, commission, bondedTotal, countNominators, isActive, nominators[], eraStat[], missedEras[], fetchStatus: 'pending' | 'loading' | 'done' | 'failed' | 'queued' }`.

### 15.5 `usePoolChecker()`

Same statuses. Exposes `pools[]`, `progress` (5 phases listed in §8.3), `latestEra`, `logs[]`.

Methods: `runCheck(eraCount)`, `stop()`, `reset()`, `retryPoolValidator(poolId, address)`.

Pool shape: `{ poolId, metadata, state, stashAddress, stashDisplay, rewardAddress, rewardDisplay, memberCount, totalBonded, commission, nominatedValidators[], eraRewards[], missedEras[], eraValidatorBreakdown: Map<era, {rewarded, unrewarded}>, fetchStatus }`.

### 15.6 Severity helpers (`src/utils/eraAnalysis.js`)

- `getSeverity(missedCount)` → `'none' | 'low' | 'medium' | 'high'` per §8.8.
- `computeMissedEras(eraStat, latestEra, eraCount)`.
- `findConsecutiveGroups(missedEras)` — groups of length ≥ `CONSECUTIVE_MISS_THRESHOLD` (3).
- `resolveLatestEra(validators)`.
- `computePoolMissedEras(eraRewards, latestEra, eraCount)`.

### 15.7 Export / import (`src/utils/balanceExport.js`)

Used by both Balance and Reward History tools.

- Formats: JSON / CSV / XML.
- JSON: `{ _rpcConfig, records: [...] }` (records include both BigInt-serialized strings and parallel `_enj` floats for convenience).
- CSV: header row + comment lines (`# endpoint:`, `# address:`, `# exportedAt:`).
- XML: `<enjinBalanceHistory>…</enjinBalanceHistory>`.
- Encryption: AES-256-GCM, PBKDF2-SHA-256 with 100 000 iterations.
- File downloads use a Blob URL, revoked after 60 s.
- Filenames sanitized via `safeFilename()`.

---

## 16. Routes and proxy surface (informational)

Browser-visible routes:

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | GET | SPA entrypoint |
| `/#era`, `/#staking`, `/#balance`, `/#reward-history`, `/#infusion` | — | hash-routed views |
| `/api/<encoded-url>` | POST | Subscan proxy (server injects `SUBSCAN_API_KEY`) |
| `/api/enj-wallet-tokens?address=` | GET | Etherscan ERC-1155 transfer history |
| `/api/enj-token-details?owner=&tokenId=` | GET | Token creator + metadata |
| `/api/eth-call` | POST | `eth_call` proxy for the ENJ infusion contract |
| `/__enj-wallet-tokens`, `/__enj-token-details`, `/__eth-call` | various | local-dev equivalents (Vite middleware) |
| `/relay-era-reference.csv`, `/canary-relay-era-reference.csv` | GET | bundled era boundary CSVs |
| `/era-explorer.html` | GET | standalone (non-React) fallback page; framed `SAMEORIGIN` |

These are infrastructure details; the redesign shouldn't change them, only consume them.

---

## 17. Acceptance checklist for the redesign

A redesign is "complete" only when **all** of the following hold:

- [ ] Every nav item in §4.2 reaches the matching tool.
- [ ] Hash-routing (`#era`, `#staking`, `#balance`, `#reward-history`, `#infusion`) survives reload and navigation.
- [ ] First-visit disclaimer fires on first load and cannot be dismissed before the 5-second countdown.
- [ ] Era Explorer connects to live + archive nodes, shows all six metric cards, an EKG that pulses on every block, an era progress bar, a debug panel, and a Past Era Lookup with UTC/Local toggle.
- [ ] Past-era lookup resolves via CSV → live RPC → binary search, in that order.
- [ ] Staking page lets the user toggle Validators ↔ Pools, set a 1–100 era window, and run / stop / reset a scan whose 4–5 phases are all visualized in the Phase Progress card.
- [ ] Validator and Pool grids paginate at 10 per page, each card opens a modal with two tabs and the right tables.
- [ ] Severity badges follow the §8.8 thresholds; `≥ 3` consecutive misses raise a Critical Alert section.
- [ ] Balance Viewer supports all five preset networks (with SS58 prefix validation), three range modes (Block / Era / Date — Date and Era only on relay & canary-relay), six date presets, decimated chart with five modes, sortable + paginated table, and JSON / CSV / XML export with optional AES-256-GCM encryption.
- [ ] BalanceTable renders `newFormat` rows correctly ("frozen" / "n/a" labels).
- [ ] Reward History Viewer supports Era and Date range modes, optional "include past pool interactions", three charts, a filterable / paginated Ledger table with all 10 columns including APY*, summary stats, and the same export/import flow.
- [ ] APY column keeps the `*` and the disclaimer card linking to `docs/reward-history-computation.md`.
- [ ] Reward figures are net of operator commission (`netReinvested()` from `src/utils/rewardMath.js`); the "Historical figures corrected" note remains in the tool info panel.
- [ ] ENJ Infusion checker supports both Token ID and Wallet modes, RPC fallback chain (Alchemy → Etherscan → public RPC), per-token retry, "Retry All Failed", a sortable bulk results table with image previews, and a token detail modal.
- [ ] All hook contracts in §15 are honored without modification.
- [ ] Sticky terminal log appears on every tool view with level-colored entries and works as a drawer.
- [ ] All `.btn-stop` / Stop buttons abort cleanly via `AbortController`.
- [ ] No API key is reachable from the bundle or any client request.
- [ ] No `innerHTML` / `dangerouslySetInnerHTML`.
- [ ] All BigInt balance math uses BigInt; never floats.
- [ ] Log arrays are capped (200 for Era Explorer, 500 elsewhere).
- [ ] Charts decimate to ≤ 250 points and destroy on unmount.
- [ ] WCAG AA color contrast and visible focus rings throughout.
- [ ] Pointer aura is suppressed on coarse pointer / `prefers-reduced-motion`.
- [ ] All four field colors in the Balance chart match §9.5 exactly.
- [ ] Vitest tests in `src/**/*.test.js` still pass (`npm run test`).
- [ ] `npm run build` produces a static bundle that boots from a hard reload.
