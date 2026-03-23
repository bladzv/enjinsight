# EnjinSight — UI Element Reference

This document describes every screen, section, and interactive element in the EnjinSight web application. It is written for a non-technical audience and is intended to serve as a reference for redesign or prototyping work.

---

## What EnjinSight Does

EnjinSight is a browser-based monitoring and analytics dashboard for the Enjin Blockchain ecosystem. It is a collection of three independent tools, each accessible from a home screen. There is no login, no account, and no server — everything runs directly in the user's browser.

The three tools are:

1. **Era Block Explorer** — Shows live blockchain clock data (eras, sessions, blocks) and lets users look up historical information for any past era.
2. **Staking Rewards Cadence** — Scans validators and nomination pools to identify missing reward payouts over a chosen number of recent eras.
3. **Historical Balance Viewer** — Queries an archive node directly to chart and tabulate the token balance history of any wallet address across a chosen block or date range.

---

## Global Header

The header appears at the very top of every page and stays fixed as the user scrolls.

### Left side
- **Logo mark** — A small square icon containing the Enjin logo.
- **App title** — The text "EnjinSight".
- **Scanning indicator** (visible only while a scan is running) — A small pulsing cyan dot overlaid on the logo mark.

### Right side
- **Scanning label** (visible only while a scan is running) — Small text reading "Scanning" with a pulsing icon, confirming that background work is in progress.
- **GitHub link** — A button with the GitHub icon and the label "GitHub". Opens the project's source code repository in a new browser tab.

### Breadcrumb bar (visible on every tool page, hidden on the home screen)
Below the main header bar, a secondary strip appears when the user is inside a tool.

- **Breadcrumb path** — Small text showing "Tool Selection › [Tool Name]", indicating where the user is.
- **Go back button** — A "‹ Go back" link that returns the user to the home screen tool selection.

---

## Landing Page (Home Screen)

The home screen is shown when the app first loads or when the user clicks "Go back".

### Hero section
- **Category pill** — A small rounded badge with the text "Enjin Blockchain".
- **App title** — Large heading reading "EnjinSight".
- **Tagline** — A short paragraph: "Monitoring and analytics utilities for the Enjin Blockchain ecosystem. Choose a tool to get started."

### Tool selection cards

Three cards are displayed in a responsive grid (one per row on mobile, up to three across on wide screens). Each card contains the following elements:

#### Card 1 — Era Block Explorer
- **Icon** — A layers/stack icon.
- **Title** — "Era Block Explorer"
- **Description** — "Explore historical era and session boundaries on the Enjin Relaychain. Look up start/end blocks and UTC timestamps for any past era."
- **Button** — "Open Era Explorer"
- **Data source chip** — Small badge reading "Data Source: Relaychain RPC Endpoint"

#### Card 2 — Staking Rewards Cadence
- **Icon** — A bar chart icon.
- **Title** — "Staking Rewards Cadence"
- **Description** — "Scan validators and nomination pools for missing reward payouts across recent eras on the Enjin Relaychain. Identify risk severity and track nominator exposure at a glance."
- **Button** — "Open Staking Checker"
- **Data source chip** — Small badge reading "Data Source: Subscan API Endpoint"

#### Card 3 — Historical Balance Viewer
- **Icon** — A line chart icon.
- **Title** — "Historical Balance Viewer"
- **Description** — "Query any Enjin Blockchain address directly via archive-node WebSocket RPC. Visualise free, reserved, and frozen balances over any block range across Matrixchain or Relaychain. Export or import data offline."
- **Button** — "Open Balance Viewer"
- **Data source chip** — Small badge reading "Data Source: Archive RPC Endpoint"

---

## Tool 1 — Era Block Explorer

This tool opens inside an embedded frame that fills the entire page below the header. It connects live to the Enjin Relaychain and displays real-time and historical era/block information.

### Current Era section

A heading "Current Era" separates this section from the rest of the page.

A two-column layout shows a grid of stat cards on the left and a live monitor on the right.

#### Stat cards (left column — 2 rows × 3 columns)
Each card shows a label at the top and a number beneath it.

| Card label | What it shows |
|---|---|
| **Active Era** | The current era number, highlighted in purple. |
| **Era Start Block** | The block number where the current era began. |
| **Era End Block** | The estimated block number where the current era will end. A note reads "start + 14,399 (est.)". |
| **Session Index** | The current session number within the era. |
| **Current Block** | The latest block number on the chain. |
| **Blocks Remaining** | How many blocks are left until the current era ends. |

#### Right column
- **Block Activity monitor** — A live animated waveform (EKG-style graph) that pulses with each new block. Labelled "Block Activity".
- **Era progress card** — Shows the label "Era progress", a percentage figure, and a coloured animated progress bar filling left to right.

---

### Past Era Lookup section

A heading "Past Era Lookup" separates this section.

A card contains the entire lookup interface:

- **Hint text** — A short status or instruction message (e.g. "Discovering pallets and syncing live data…" while loading, or instructions once ready).
- **"Era index" label** — Text label for the input field.
- **Era index input** — A number field where the user types any past era number (e.g. "100").
- **"Look up" button** — Triggers the lookup. Disabled until the app has connected to the chain.

Once a valid era is looked up, four result cards appear:

| Result card label | What it shows |
|---|---|
| **Start Block** | The block number where that era began. A pill badge below indicates whether the value came from the live RPC or from a pre-computed CSV reference. |
| **End Block** | The block number where that era ended. Same pill badge. |
| **Start UTC** | The UTC date and time when that era started. |
| **End UTC** | The UTC date and time when that era ended. |

Each date/time card also has:
- **"Show in my local time" toggle** — A button that switches the displayed time between UTC and the user's local timezone.

An additional result card may appear:
- **Start Block Hash** — The cryptographic hash of the era's starting block, displayed in truncated form. Includes a **copy icon button** to copy the full hash to the clipboard.

**Alert box** — A coloured message strip that may appear below the result cards to show warnings, errors, or informational notes.

---

### Debug / Pallet Discovery panel

A collapsible panel below the lookup card. Its header shows a bug icon and the label "Debug / Pallet Discovery" with a collapse arrow.

When expanded, it shows a table of raw technical diagnostics including WebSocket connection state, discovered pallet names, storage key values, and the last error — useful for troubleshooting connectivity issues.

---

### RPC Call Log (sticky footer)

A thin bar fixed at the very bottom of the screen. It shows the terminal icon, the label "LOGS" or "RPC Call Log", and a preview of the last log message. Clicking it expands a scrollable log panel showing all timestamped messages from the live RPC connection.

---

## Tool 2 — Staking Rewards Cadence

This tool scans the Enjin Relaychain for missing staking reward payouts. It works in two modes: Validators and Nomination Pools.

### Mode selector tabs

Two tabs at the top of the tool, styled as a tab bar:

- **Validators** tab — Shows a shield icon and the label "Validators".
- **Nomination Pools** tab — Shows a people/group icon and the label "Nomination Pools".

Tabs are disabled (grayed out and unclickable) while a scan is in progress.

---

### Control panel (scan configuration card)

A card below the mode tabs where the user configures and triggers the scan.

**In Validators mode:**
- **Heading** — "Check Validator Rewards"
- **Helper text** — "Enter the number of recent eras (1 era approx 24 hours) to scan for validator rewards."

**In Nomination Pools mode:**
- **Heading** — "Check Pool Rewards"
- **Helper text** — "Enter the number of recent eras (1 era approx 24 hours) to scan for pool payouts."

#### Input + action button (combined element)
- **"Number of recent eras to check (max 100)" label** — Above the input field.
- **Era count input** — A large centered number field (digits only, 1–100). The placeholder shows the default value.
- **Action button** (embedded inside the right side of the input field) — This button changes label depending on app state:
  - **"CHECK"** — with a search icon. Starts the scan using the entered era count.
  - **"STOP"** (red, with a stop square icon) — Visible while scanning. Immediately halts the scan.
  - **"RESET"** — with a rotate/undo icon. Appears after a scan completes, stops, or errors. Clears all results and returns the tool to its initial state.

**Validation messages** (below the input):
- If the input is invalid: a red error message appears, e.g. "Please enter a whole number." or "Maximum is 100."
- If the value is greater than 30: an amber warning message appears: "Checking [N] rewards may take longer. Large scans are batched automatically."

---

### Summary section

Appears after a scan completes, above the individual result cards. Labelled "Summary" with a horizontal rule.

#### Overview stat chips (3-chip row)
Three coloured chips display at-a-glance counts:

| Chip label | Colour | What it shows |
|---|---|---|
| **Validators** (or **Total Pools**) | Neutral | Total number scanned. |
| **Clean Record** (or **All Rewarded**) | Green | Number with no missed eras. |
| **Has Gaps** | Amber (if > 0) or Green (if 0) | Number with at least one missed era. |

#### Critical alert banners
If any validator or pool has missed **3 or more consecutive eras**, one red alert banner appears per streak:

- A red triangle warning icon.
- Text in the format: "Critical: Validator [Name] has missed [N] consecutive eras (eras [X]–[Y]). Pool operators backing this validator should investigate immediately."
- An **external link icon** button that opens the validator or pool on the Subscan block explorer.

#### "Validators with Missing Rewards" / "Pools with Missing Rewards" table

A card with a header showing the warning icon, the title "Validators with Missing Rewards" (or "Pools with Missing Rewards"), and an amber count badge.

The table has these columns:

| Column | Description |
|---|---|
| **Validator** / **Pool** | Name or truncated address, with an external Subscan link icon. |
| **Checked** | Number of eras that were examined. |
| **Rewarded** | Number of eras where a reward was received. |
| **Missed** | Number of eras where a reward was absent (shown in red). |
| **Missing Eras** | A comma-separated list of the specific era numbers with no reward. |
| **Severity** | A coloured badge: "Low", "Medium", or "High", based on how many eras were missed. |
| **Reason** (pools only) | May show "No validators nominated" as an explanation for expected gaps. |

**Pagination controls** (below the table, if more than one page):
- **Rows per page** dropdown — Options: 5, 10, 20.
- **"‹ Prev"** and **"Next ›"** buttons — Navigate between pages.
- **Page indicator** — Text in the format "1 / 3".

If no validators or pools have gaps, this section is replaced by a single success message: "All validators received rewards for every era in the last [N] eras. ✨"

#### "Perfect Record" collapsible section

If some validators/pools passed cleanly, a collapsible card appears:

- **Expand/collapse button** — Shows a green checkmark icon and the text "Perfect Record ([N] validators)" with a chevron arrow.
- When expanded: a grid of validator/pool names, each with a green checkmark and an external Subscan link icon.

#### Error notice
If any items failed to load, a small amber warning message appears: "[N] validator(s) had fetch errors and are excluded from gap analysis."

---

### Validator cards / Pool cards

One card per validator or pool, displayed in a list below the Summary section.

#### Collapsed state (always visible)

Each card shows a single row:

- **State badge** — A small rounded pill. For validators: "Active" (blue) or "Waiting" (gray). For pools: "Open" (blue), "Locked", "Destroying", or "Loading".
- **Name** — Validator identity name or truncated address. Pool name or "Pool #[ID]".
- **Warning icon** — A yellow triangle appears if the validator/pool has missed eras, with a tooltip showing the count.
- **Loading spinner** — A small spinning icon while data is being fetched.
- **Commission** — Text in the format "Commission: [N]%".
- **Bonded** — Text in the format "Bonded: [amount] ENJ". For pools, also shows "Members: [N]" and "Validators: [N]".
- **Copy address button** — Icon button. Copies the stash address to the clipboard. Briefly shows a green checkmark on success.
- **Open on Subscan button** — Icon button with an external-link arrow. Opens the validator or pool on the Subscan block explorer.
- **Queued badge** — Small text badge reading "Queued" if the item is waiting to be fetched.
- **Retry button** — A refresh icon button that appears in red if the data fetch failed, allowing the user to re-fetch.
- **Expand/collapse chevron** — An up or down arrow at the far right. Clicking anywhere on the row toggles the card open or closed.

#### Expanded state (shown below the row)

When a card is expanded, a two-tab panel appears:

**For Validator cards:**

**Tab 1 — "Era Rewards"**
- Tab label: "Era Rewards", with a bar chart icon.
- Tab badge: Shows "[N] missed" in amber if there are gaps, or "[N] eras" as a neutral count otherwise.

Contains the **Era Stats table**:

Pagination controls (per-page selector: 5, 10, 20, 50 rows; Prev/Next navigation).

Table columns:
| Column | Description |
|---|---|
| **Era** | The era number. Shown in red for missed eras. |
| **Start Block** | First block of that era. |
| **End Block** | Last block of that era. |
| **Reward Point** | The validator's reward points for that era. |
| **Blocks Produced** | How many blocks the validator authored. |

Missed eras render as a red-tinted row spanning all columns with the text "— No era stat recorded —" (abbreviated to "No data" on small screens).

---

**Tab 2 — "Nominators"**
- Tab label: "Nominators", with a people/group icon.
- Tab badge: A count of how many nominators are backing this validator.

Contains the **Nominators table**:

Pagination controls (per-page selector: 10, 20 rows; Prev/Next navigation).

Table columns:
| Column | Description |
|---|---|
| **#** | Row number. |
| **Address** | Truncated wallet address, with a copy-to-clipboard icon button. |
| **Display Name** | Identity name if set, otherwise an em-dash. |
| **Bonded** | Amount of ENJ staked by this nominator. |

On small screens, each nominator is shown as a compact card instead of a table row.

---

**For Pool cards:**

**Tab 1 — "Era Rewards"** (default)
- Tab label: "Era Rewards", with a bar chart icon.
- Tab badge: "[N] missed" in amber, or "[N] rewards" as a neutral count.

Contains the **Pool Reward table**:

Pagination controls (per-page selector: 5, 10, 20, 50 rows; Prev/Next navigation).

Table columns:
| Column | Description |
|---|---|
| **Era** | The era number. |
| **Reward** | Total ENJ rewarded to the pool that era, in decimal format. |
| **Rewarded** | Number of nominated validators that earned rewards (hidden on mobile). |
| **No Reward** | Number of nominated active validators that did not earn a reward (hidden on mobile). |
| **Status** | "Rewarded" (green checkmark) or "No Reward" (red X). |
| **Expand arrow** | A chevron button to see a per-validator breakdown for that era. |

When a row is expanded, a sub-row appears listing each nominated validator and whether it was rewarded or not that era, with its name, a truncated address, and an external Subscan link.

---

**Tab 2 — "Validators"**
- Tab label: "Validators", with a people/group icon.
- Tab badge: Count of nominated validators.

Contains the **Pool Validators table**: a list of currently nominated validators with name, address, and external links.

---

### Terminal Log (sticky footer)

A collapsible panel fixed at the bottom of the screen throughout the scan.

- **Toggle bar** — Always visible. Shows a terminal icon, the label "LOGS" (in uppercase), a preview of the most recent log message, and a count badge showing the total number of log entries.
- **Expand/collapse chevron** — A small up or down arrow at the right edge of the toggle bar.
- **Log body** — Scrollable area showing timestamped log entries with colour-coded level tags:
  - **[INFO]** — General progress messages.
  - **[OK]** — Successful steps.
  - **[WARN]** — Non-fatal warnings.
  - **[ERR]** — Errors.
  - **[DONE]** — Scan completion message.
- **Idle state** — When no scan has run yet, the preview text reads "Ready — waiting for CHECK…".

---

## Tool 3 — Historical Balance Viewer

This tool retrieves the token balance history of any wallet address by connecting directly to an archive blockchain node. It can visualise and export the data.

### Input card

A card at the top of the tool containing the full query configuration. The card itself has two tabs at the top.

#### Tab bar
- **"Query Node" tab** — With a server icon. The default tab. Shows the form for fetching new data.
- **"Import Data" tab** — With an upload icon. Shows the import interface for loading previously exported files.

---

### Query Node pane

#### RPC Configuration section
A small section heading labelled "RPC CONFIGURATION".

- **"Archive Node WS Endpoint" label** — Above a dropdown.
- **Endpoint dropdown** — A selector listing available preset Enjin network nodes (e.g. Matrixchain Mainnet, Relaychain Mainnet, etc.) plus a "Custom" option.
- **Resolved endpoint display** — For preset selections, the raw WebSocket URL is shown in small text below the dropdown.
- **Custom endpoint input** — Visible only when "Custom" is selected. A text field where the user can paste their own WebSocket URL. Placeholder: "wss://your-archive-node".
- **"Wallet Address (SS58)" label** — Above the address input.
- **Address input** — A text field for entering the on-chain wallet address. The placeholder text adjusts to show a sample address format for the selected network.
- **Address validation note** — May appear below the address field:
  - Amber warning if the entered address format belongs to a different network: "⚠️ Converted address for [Network]: [converted-address]"
  - Red error if the address is structurally invalid: "❌ Invalid address: [reason]"

#### Query Range section

A toggle row labelled "QUERY RANGE" switches between two range modes:

- **"Block Range" toggle button** — Select this to enter block numbers directly.
- **"Date Range" toggle button** (with a calendar icon) — Select this to enter calendar dates.

**When "Block Range" is selected:**
- **"Start Block" label** and number input — Placeholder: "e.g. 1000000"
- **"End Block" label** and number input — Placeholder: "e.g. 1001000"
- **"Step (every N blocks)" label** and number input — Controls how frequently a snapshot is taken. Default: 100.

**When "Date Range" is selected:**

Quick Range presets (row of small buttons):
- **"1 day ago"**, **"1 week ago"**, **"1 month ago"**, **"3 months ago"**, **"6 months ago"**, **"1 year ago"** — Each button automatically fills in the start and end date fields.

Date inputs:
- **"Start Date" label** and date picker input.
- **"End Date" label** and date picker input.
- **"Step (every N blocks)" label** and number input — Same as block range; controls snapshot frequency.

#### Estimate row

Below the range inputs, an informational line shows:
- **Estimated RPC calls** — e.g. "~250 calls"
- **Estimated time** — e.g. "~2m 30s"

#### Action buttons

- **"FETCH" button** (primary, blue/purple) — Starts the query. Disabled if required fields are missing.
- **"CANCEL" button** (red stop button, visible while fetching) — Stops the in-progress WebSocket query.
- **"RESET" button** (with a rotate icon, visible after results are loaded) — Clears results and resets the form.

**Progress bar** — Visible while a fetch is in progress. Shows a colour gradient bar with percentage text.

**Error message** — A red alert strip that appears if the connection or query fails.

---

### Import Data pane

Shown when the "Import Data" tab is selected.

#### Drop zone
- A large bordered rectangle (dashed border).
- **Icon** — A folder open icon.
- **Primary text** — "Drop file here or click to browse"
- **Secondary text** — "Supports JSON, CSV, XML exports from this app (max [N] MB)"
- Clicking anywhere in the zone opens the system file picker. Files can also be dragged and dropped onto it. The border and background change colour when a file is dragged over.

When a file is being read, the icon is replaced with a spinner and the text "Reading file…"

#### Encrypted file password prompt (conditional)
If the dropped/selected file is an encrypted export, an additional form appears:
- **"Decryption Password" label** and password input field.
- **"Decrypt & Import" button**.

**Alert strip** — Coloured messages appear at the top of the pane to report success or failure.

---

### Results area

Appears below the input card once data has been loaded (either via query or import).

#### Records bar

A narrow strip showing:
- **Block range** — "Blocks [start] – [end]"
- **Record count** — e.g. "250 records"
- A data source label and timestamp.

---

### Balance Chart card

A card with the heading "Balance Chart".

#### Chart header
- **"Balance Chart" section label** (cyan text).
- **Sample note** (conditional) — Small text showing "~[N] sampled of [total]" if decimation occurred due to a very large dataset.
- **Chart height controls** — Three small icon buttons:
  - **"−"** — Decreases chart height.
  - **Percentage display** — Shows the current zoom level, e.g. "100%".
  - **"+"** — Increases chart height.
  - **"⊙"** — Resets chart height to default.

#### Chart mode buttons

A row of pill-shaped toggle buttons to switch the chart type:
- **"Total (Stacked)"** — Shows all balance types stacked in a bar chart.
- **"Free"** — Line chart showing only the free (spendable) balance.
- **"Reserved"** — Line chart for reserved balance.
- **"Misc Frozen"** — Line chart for miscellaneous frozen balance.
- **"Fee Frozen"** — Line chart for fee-frozen balance.

#### Chart canvas

The chart area itself. Hovering over the chart shows a tooltip with:
- Block number and hash.
- ENJ values for all balance fields.
- A vertical dashed crosshair line tracking the cursor.

---

### Balance History table card

A card with the heading "Balance History".

#### Table header
- **"Balance History" section label** (cyan text).
- **Record count** — e.g. "250 records".
- **Table zoom controls** — Three small icon buttons:
  - **"−"** — Makes table text smaller.
  - **Size indicator** — Shows "S", "M", or "L".
  - **"+"** — Makes table text larger.
  - **"⊙"** — Resets text size to default (S).

#### Sortable table

Clicking any column header sorts the table by that column (toggle between ascending and descending). An arrow (↑ or ↓) marks the active sort column.

Columns:
| Column | Description |
|---|---|
| **Block** | Block number. Sortable. |
| **Hash** | Truncated block hash. Hovering shows the full hash in a tooltip. |
| **Free (ENJ)** | Free balance at that block. |
| **Reserved (ENJ)** | Reserved balance. |
| **Misc Frozen (ENJ)** | Miscellaneous frozen balance (may display as "Frozen (ENJ)" for newer chain format). |
| **Fee Frozen (ENJ)** | Fee-frozen balance (may display as "n/a" for newer chain format). |

---

### Export Data card

Appears only when data was fetched directly (not imported). Heading: "Export Data".

- **Encrypt Output toggle** — A sliding toggle switch. Label: "Encrypt Output (AES-256-GCM)". Clicking the entire row toggles it. Shows a lock icon when enabled, an unlocked icon when disabled.
- **"Encryption Password" label** and password input — Visible only when encryption is enabled. Placeholder: "Enter password…"
- **"Filename" label** and text input — For the downloaded file name. Placeholder shows an auto-generated default filename.
- **"Format" label** and dropdown — Options: "JSON", "CSV", "XML".
- **"Export" button** (primary) — Downloads the file. Shows a spinner while the file is being prepared. Disabled if there are no records.

**Status message strip** — Appears above the controls after an export attempt:
  - Green success: "File saved: [filename]"
  - Red error: "Export failed: [reason]"

---

### Terminal Log (sticky footer)

Identical in appearance and behaviour to the one described in Tool 2 (Staking Rewards Cadence). It streams real-time status from the WebSocket RPC connection.

---

## Severity System (Staking Rewards Cadence)

Throughout Tool 2, missed eras are rated by severity. The labels and colours are:

| Badge label | Colour | Meaning |
|---|---|---|
| **Low** | Amber/yellow | A small number of missed eras. |
| **Medium** | Orange | A moderate number of missed eras. |
| **High** | Red | A large number of missed eras — warrants attention. |

A separate **Critical** alert (red banner, not a badge) is shown for 3 or more *consecutive* missed eras.

---

## Status Badges (Validators and Pools)

| Badge label | Colour | Meaning |
|---|---|---|
| **Active** | Cyan/blue | Validator is currently in the active set. |
| **Waiting** | Gray | Validator is in the waiting set, not currently active. |
| **Open** | Cyan/blue | Nomination pool is accepting members. |
| **Locked** | Gray | Pool is locked and not accepting new members. |
| **Destroying** | Gray | Pool is in the process of being shut down. |
| **Loading** | Gray | Data is still being fetched for this item. |

---

## Empty and Loading States

- While a validator or pool card's data is loading, the header row shows a **small spinning loader icon** next to the name.
- If data fetch fails, the header row shows a **red "Retry" icon button** (refresh icon).
- Expanded tabs that have not yet loaded show a **"Fetching [data type]…"** placeholder with a spinner.
- Expanded tabs whose fetch failed show a **"[Data type] fetch failed."** message with a retry button.
- Tables with no data show a centered message: **"No [data type] found."** or **"No [data type] data available."**
