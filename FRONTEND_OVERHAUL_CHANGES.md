# EnjinSight Frontend Overhaul Change List

## Design System Direction

- Reframed the application as a chain operations console instead of a decorative analytics landing experience.
- Replaced the previous high-glow purple/cyan visual language with a restrained graphite interface and clearer operational accents.
- Established a new visual thesis: dense, read-only chain tooling with calm surfaces, high legibility, compact controls, and status colors that map to action or state.
- Shifted the default UI posture from marketing copy and large ornamental panels toward utility copy, scan status, tool selection, query configuration, result inspection, and export/import continuity.
- Kept the product dark because the app contains dense charts, tables, logs, long addresses, and terminal output that benefit from high-contrast dark work surfaces.
- Reduced decorative background effects so the app reads as a real tool surface on both desktop and mobile.
- Removed pointer-following glow treatment from the active app shell to reduce visual noise and improve perceived performance.
- Replaced background glow/orb treatments with a subtle grid and top-light frame that supports orientation without competing with data.
- Consolidated the visual language around neutral panels, functional dividers, compact cards, and purposeful status accents.

## Color System

- Replaced the previous dominant purple design tokens with a graphite/green/blue/gold/red system.
- Updated `ink` to a near-black graphite base for the page background.
- Updated `surface` to a dark graphite layer for major work regions.
- Updated `card` to a slightly lifted graphite layer for repeated records and framed controls.
- Updated `surface-high`, `surface-highest`, and `surface-bright` to clearer interactive states.
- Updated `primary` to ENJ-style green for primary actions, active selection, and positive operational focus.
- Updated `primary-dim` to a deeper green for gradients and progress starts.
- Updated `primary-glow` to a light green for action gradients and subtle glow states.
- Kept blue as a secondary data/status accent for live telemetry, chart contrast, and non-primary highlights.
- Tuned warning to a readable gold that works against the dark background.
- Tuned danger to a clearer red that remains distinct from warning and primary.
- Updated text tokens so body text is less purple-tinted and more neutral.
- Updated muted text to a lower-contrast graphite-green gray for secondary metadata.
- Added shared CSS variables for line color, panel radius, and UI radius.
- Reworked chart palette values in Reward History so graph colors now match the new system.
- Replaced old hard-coded chart tooltip colors with the new graphite/green/blue tokens.
- Replaced old hard-coded purple/cyan gradient border helper with green/blue.
- Replaced the old cyan SVG ready-scan strokes in the staking empty state with the new blue token.

## Surface And Radius System

- Reduced the overall border radius language to a tighter console-style 8px rhythm.
- Kept full pill radii only for true pills, chips, switches, and status badges.
- Mechanically normalized oversized `rounded-[...]`, `rounded-xl`, and `rounded-2xl` usage across the React components to `rounded-lg`.
- Updated shared component classes such as `card`, `observatory-panel`, `page-hero`, `metric-card`, `data-panel`, `inset-panel`, `data-table-wrap`, `chart-frame`, and range controls to use the shared radius variables.
- Added clearer line borders to framed panels using the shared `--line` token.
- Reduced heavy ambient shadows so panels feel layered but not floating or decorative.
- Kept shadows mostly for separation between work surfaces and the page background.
- Added stronger inset treatment for nested control areas where it helps scan hierarchy.
- Reduced decorative card-grid energy in the home page by moving tool entries toward compact horizontal work rows.

## Typography And Text Density

- Preserved the existing font stack while tightening heading scale for application surfaces.
- Reduced hero heading scale so headers feel like tool headers, not landing-page campaign headlines.
- Kept `Space Grotesk` for headings and brand presence.
- Kept `Inter` for dense labels, form controls, tables, and operational text.
- Reduced excessive uppercase tracking in labels and tabs for better fit on mobile.
- Kept uppercase labels where they help scanning, but tuned letter spacing to avoid cramped compact panels.
- Maintained monospace usage for addresses, block numbers, era numbers, hashes, raw values, and logs.
- Preserved long-address wrapping and break behavior to prevent overflow.
- Reduced repeated helper copy in navigation and primary shell by moving some context into tooltips.

## App Shell

- Replaced the app-level glow/orb background with `app-frame` and `app-noise` utility layers.
- Removed `PointerAura` from the active app render path.
- Kept the application shell full-height and horizontally clipped to protect mobile layouts.
- Preserved the URL hash routing behavior for all tools.
- Preserved first-visit disclaimer and About modal behavior.
- Preserved lazy Vercel Analytics loading behavior.
- Kept the sticky terminal log behavior for the staking view.

## Header And Navigation

- Reworked `AppHeader` into a compact tool navigation bar.
- Added Lucide icons for every primary route:
  - Home
  - Era Explorer
  - Staking Cadence
  - Balance Viewer
  - Reward History
  - ENJ Infusion
- Reduced desktop navigation labels to shorter scan-friendly labels while keeping full route names available via tooltips and accessible labels.
- Converted README, About, and GitHub actions into icon buttons with tooltips.
- Preserved external README and GitHub links.
- Preserved About modal trigger behavior.
- Preserved mobile hamburger behavior.
- Added icons to mobile menu entries for faster visual recognition.
- Kept active route indication through `aria-current`.
- Kept hamburger `aria-expanded` behavior.
- Kept active scan status indicator on the brand logo when a scan is running.
- Tightened header spacing and logo sizing for better fit on small screens.
- Reduced header chrome by removing visible README/About/GitHub text on desktop and replacing it with tooltip-backed icon actions.

## Tooltip System

- Added a reusable `Tooltip` component at `src/components/Tooltip.jsx`.
- Implemented tooltip styling through `.ui-tooltip`.
- Added hover and keyboard focus support through `:hover` and `:focus-within`.
- Hid tooltip popovers on non-hover devices to avoid awkward mobile overlays.
- Used tooltips in the header action buttons.
- Used tooltips in desktop primary navigation.
- Used a tooltip on scan mode options to preserve context while supporting compact scanning.
- Used a tooltip on the staking scan range label to explain what the range means without adding visible text.
- Kept semantic `aria-label` text on icon buttons so tooltips are not the only accessible name.

## Home / Toolset Page

- Rebuilt the landing page into a product workspace entry screen.
- Added a proper first-viewport tool hero with product name, concise purpose, and quick operational metrics.
- Replaced the old standalone paragraph intro with a structured hero.
- Added compact metrics for tool count, read-only mode, and export formats.
- Converted the toolset from tall equal-height cards into denser responsive tool rows.
- Preserved all five tool launch actions.
- Preserved all existing tool routes and labels.
- Kept source/API context for each tool.
- Added right-arrow affordances to launch buttons.
- Reduced card height and excessive explanatory vertical space.
- Improved desktop scanning by allowing two-column tool rows.
- Improved mobile scanning by stacking rows with clear icons and buttons.

## Staking Cadence View

- Preserved validator and nomination pool scan modes.
- Preserved validator and pool hooks and run/stop/reset behavior.
- Preserved pagination for validator and pool result cards.
- Preserved collapsible result sections.
- Preserved validator summary and pool summary behavior.
- Preserved pool selection behavior from summary into paginated pool cards.
- Preserved retry behavior for validators and pool validators.
- Updated the staking hero to inherit the new shell design system.
- Updated scan mode panel styling through `ModeSelector`.
- Updated scan controls through `ControlPanel`.
- Added a reset icon to the reset action.
- Reduced scan controls from a decorative nested panel to a cleaner operation block.
- Added a tooltip for scan range meaning.
- Kept validation messages and long-range warning behavior.
- Kept scan range minimum/maximum display.
- Kept scan action state switching:
  - Run Scan
  - Stop Scan
  - Reset View
- Kept progress display through `PhaseProgressCards`.
- Updated result shells and empty/error states through the shared radius and color system.

## Progress UI

- Updated `PhaseProgressCards` to match the new panel style.
- Added a consistent `Progress` eyebrow when no custom eyebrow is provided.
- Reduced progress card radii.
- Added a border around progress panels for better separation from the page.
- Preserved all phase percent calculations.
- Preserved completed/running/queued status mapping.
- Preserved progress ring behavior.
- Preserved `aria-live` and `aria-label` behavior.

## Balance Viewer

- Preserved query/import tabs and their behavior.
- Preserved network selection.
- Preserved address validation behavior.
- Preserved block, era, and date range modes.
- Preserved quick range presets.
- Preserved live chain snapshot rendering.
- Preserved archive RPC query execution.
- Preserved cancel/reset/fetch action behavior.
- Preserved estimated RPC call and time display.
- Preserved import workflow for JSON, CSV, XML, and encrypted files.
- Preserved chart, smart insights, table, and export rendering.
- Updated all major Balance Viewer surfaces through shared design tokens.
- Normalized panel and nested card radii across query configuration, range controls, import shell, summary bar, chart, table, and export surfaces.
- Improved mobile resilience by keeping existing responsive grids and wrapping behavior.

## Reward History Viewer

- Preserved compute/import tabs and their behavior.
- Preserved relaychain address input.
- Preserved historical pool interaction toggle.
- Preserved era and date range modes.
- Preserved quick date presets.
- Preserved compute/stop/reset behavior.
- Preserved imported reward data workflow.
- Preserved reward summary, charts, filters, tables, export, and import.
- Updated line chart colors to new system tokens.
- Updated doughnut chart palette to match the new system.
- Updated Chart.js tooltip background, title color, body color, grid color, and axis color.
- Preserved chart data calculations and chart lifecycle cleanup.
- Preserved reward CSV/JSON/XML export serialization.
- Preserved encrypted export/import behavior.
- Normalized panel radii across charts, tables, import panels, warning blocks, notes, and result summary surfaces.

## Era Explorer

- Preserved live WebSocket era/session/block behavior.
- Preserved heartbeat animation.
- Preserved active era statistics.
- Preserved era progress bar.
- Preserved debug panel expand/collapse behavior.
- Preserved past-era lookup form.
- Preserved UTC/local time toggle.
- Preserved copy hash behavior.
- Preserved CSV-backed era data status display.
- Updated hero, metrics, heartbeat panel, progress panel, debug panel, and lookup panel through the shared design system.
- Kept blue as the live telemetry accent in the heartbeat and status UI.

## ENJ Infusion Checker

- Preserved single token ID lookup.
- Preserved wallet bulk scan mode.
- Preserved token ID and Etherscan URL normalization.
- Preserved Ethereum wallet validation.
- Preserved multi-endpoint RPC fallback.
- Preserved Etherscan wallet/token API proxy usage.
- Preserved bulk concurrency, pagination, search, sorting, retry failed row, retry all failed rows, and detail modal behavior.
- Preserved token preview and metadata rendering.
- Updated hero, contract scope, scan forms, result value, progress, bulk result table, pagination, and modal surfaces through shared design tokens.
- Kept Token ID / Wallet segmented control behavior.
- Kept visible wallet scan note because it prevents incorrect interpretation of incomplete wallet token lists.

## Tables And Dense Data

- Preserved horizontal scrolling wrappers for wide data tables.
- Preserved sticky table headers.
- Updated table header color and letter spacing.
- Updated row hover state to the new surface-bright token.
- Kept alternating row and danger row states.
- Preserved compact select and input controls used in filters and tables.
- Preserved pagination affordances.
- Reduced general UI curvature around table wrappers.
- Kept monospace formatting for technical values.

## Forms And Controls

- Updated `input-field`, `select-field`, and `select-compact` to include consistent borders and radii.
- Kept focus-visible outlines and rings.
- Preserved mobile input behavior and `touch-action: manipulation`.
- Preserved disabled opacity behavior.
- Preserved form validation text and alert roles where present.
- Updated primary buttons to the new green action gradient.
- Updated secondary buttons to graphite outlined actions.
- Updated danger/stop buttons to the new red system.
- Tightened button padding so toolbars and mobile forms fit better.
- Preserved icon usage inside command buttons.
- Preserved segmented controls and switches.

## Accessibility

- Preserved existing semantic landmarks, labels, tabs, and form controls.
- Preserved `aria-current` on active navigation.
- Preserved `aria-expanded` for collapsible sections and mobile menu.
- Preserved `aria-selected`, `aria-controls`, and `role="tab"` in mode selectors and tab controls.
- Added tooltip support that works on focus as well as hover.
- Kept icon buttons accessible through `aria-label`.
- Preserved alert roles for validation and error messaging.
- Preserved focus-visible styling and improved visual consistency.
- Avoided relying on color alone for many key states by keeping labels, icons, badges, and text states.

## Responsiveness

- Preserved existing mobile/desktop breakpoint structure across tools.
- Kept desktop max-width constraints on the main app content.
- Tightened the header so it fits more comfortably across desktop and tablet widths.
- Kept mobile menu scrollable within the viewport.
- Converted the home tool cards into rows that stack cleanly on mobile.
- Kept major tool forms as responsive grids that collapse to single-column layouts.
- Preserved table horizontal scrolling for narrow screens.
- Preserved wrapping for long addresses, endpoints, hashes, raw values, and status text.
- Reduced oversized hero typography to prevent wrapping collisions on mobile.
- Reduced panel radii and shadows so stacked mobile layouts feel less bulky.

## Files Changed

- `src/App.jsx`
  - Removed active pointer aura usage.
  - Added the new app frame/noise shell.
  - Updated hard-coded staking empty-state accent strokes.
  - Normalized oversized radii.

- `src/index.css`
  - Rebuilt design tokens.
  - Reworked base background.
  - Reworked shared component classes.
  - Reworked buttons, inputs, tables, metrics, range controls, chips, hero, and tooltip styles.
  - Added app frame/noise utilities.
  - Added reusable tooltip utility styles.
  - Updated legacy gradient helper.

- `tailwind.config.js`
  - Updated the color palette.
  - Updated semantic surface tokens.
  - Updated text tokens.
  - Updated box shadows.
  - Kept font families and animations intact.

- `src/components/Tooltip.jsx`
  - Added reusable tooltip wrapper component.

- `src/components/AppHeader.jsx`
  - Added route icons.
  - Added icon-first header action buttons.
  - Added tooltips.
  - Improved mobile menu icons.
  - Tightened spacing and brand sizing.

- `src/components/LandingPage.jsx`
  - Rebuilt the entry page as an app workspace.
  - Added hero metrics.
  - Converted tool cards into responsive tool rows.
  - Added launch affordance icons.

- `src/components/ModeSelector.jsx`
  - Updated panel styling.
  - Added tooltips.
  - Normalized active/inactive mode card design.

- `src/components/ControlPanel.jsx`
  - Updated panel styling.
  - Added scan range tooltip.
  - Added reset icon.
  - Reduced nested decorative styling.

- `src/components/PhaseProgressCards.jsx`
  - Updated progress panel and cards.
  - Added default progress eyebrow.
  - Reduced radii and added border separation.

- `src/components/RewardHistoryViewer.jsx`
  - Updated chart and pie palette.
  - Updated Chart.js tooltip and grid colors.
  - Normalized oversized radii.

- `src/components/*.jsx`
  - Mechanically normalized oversized radii across component surfaces.

## Behavior Intentionally Preserved

- All existing tool routes remain available.
- All existing hooks remain in place.
- All existing API/RPC utility calls remain in place.
- All import/export workflows remain in place.
- All scan start/stop/reset controls remain in place.
- All retry controls remain in place.
- All pagination controls remain in place.
- All modal/detail flows remain in place.
- All terminal logs remain in place.
- All chart/data computation logic remains in place.
- All data table and sorting/filtering logic remains in place.
- All URL hash persistence remains in place.
- All first-visit and About disclaimer flows remain in place.

## Best-Practice Alignment

- Uses shared tokens rather than disconnected one-off colors for the main system.
- Uses icon buttons where the action is familiar and tooltip-backed.
- Keeps explanatory text visible only where it changes interpretation or prevents user error.
- Keeps cards for repeated tool entries, records, modals, and genuinely framed controls.
- Avoids decorative orb backgrounds and oversized ornamental UI.
- Preserves touch-friendly controls on mobile.
- Preserves keyboard focus visibility.
- Preserves accessible labels on icon-only controls.
- Keeps data-dense views compact but readable.
- Keeps mobile overflow guarded for long technical strings.
- Keeps color roles distinct for action, information, warning, success, and danger.
