# PR: Apply Kinetic Ledger design system and update project documentation
Timestamp: 2026-03-29 10:08:49 UTC
Git Branch: docs/update-readme-claude-design
Git Commit Message: docs: update README, CLAUDE.md, and DESIGN.md to reflect Kinetic Ledger design system

---

## Summary
This PR applies the Kinetic Ledger design system across the entire EnjinSight web app and brings all project documentation up to date with the changes. A new `PhaseProgressCards` component replaces the old flat progress bar with SVG ring-progress cards, the full Tailwind token set has been updated to match the design system specification (Space Grotesk/Inter/JetBrains Mono typography, deep-navy surface hierarchy, primary/cyan/success/danger signal palette), and every UI component has been restyled to follow the "No-Line Rule" and tonal-depth layering principles. The README, CLAUDE.md, and DESIGN.md have been rewritten or extended to accurately reflect the current codebase structure, new utility files, and the Kinetic Ledger design system.

---

## Related Issues
None

---

## Added Features

### Design System
- **Kinetic Ledger tokens**: Full Tailwind config rebuild with `primary`, `primary-dim`, `cyan`, `success`, `danger`, `surface`, `card`, `text`, `text-secondary` design tokens and custom shadow/radius scales.
- **PhaseProgressCards**: New `src/components/PhaseProgressCards.jsx` — SVG ring-progress cards, one per scan phase. Renders idle (muted ring), in-progress (cyan ring + live % label), and completed (green ring + checkmark) states using a circle stroke-dashoffset animation.
- **Space Grotesk / Inter / JetBrains Mono typography stack**: Headlines use Space Grotesk (brutalist authority), body/UI copy uses Inter, and all addresses, hashes, and terminal log entries use JetBrains Mono.

### Documentation
- **README.md redesign**: Modern shield badges (React 18, Vite 7, Tailwind CSS 3, CI, Live Demo, License), accurate tech-stack table, corrected component/utility listings, updated project structure tree, and a concise security table.
- **DESIGN.md — Design System section**: New section distilling the Kinetic Ledger specification into a developer reference: core principles, color token table, component patterns, and a mockup index pointing to `docs/new_design/stitch/`.
- **CLAUDE.md — Key Files table**: Added `chainInfo.js`, `eraRpc.js`, `PhaseProgressCards.jsx`, `docs/new_design/stitch/enjinsight_obsidian/DESIGN.md`, and `tailwind.config.js`.

---

## Changes
- **All components restyled**: AppHeader, LandingPage, ModeSelector, ControlPanel, ValidatorCard, PoolCard, SummarySection, PoolSummarySection, BalanceExplorer, BalanceChart, BalanceTable, BalanceExportPanel, BalanceImportPanel, EraBlockExplorer, RewardHistoryViewer, TerminalLog updated to use Kinetic Ledger tokens and the no-line surface-layering approach.
- **`src/index.css`**: Tailwind directives extended with design-system utility classes (`.card`, `.btn-primary`, `.badge-*`, `.sev-*`, `.log-*`, `.section-label`, `.mini-chip`), CSS custom properties, and base animations (fadeIn, slideDown, heartbeat-burst, pulse-slow).
- **`tailwind.config.js`**: Full token rebuild — colors, font families, box shadows, border radii aligned to Kinetic Ledger spec.
- **`src/App.jsx`**: Layout and container classes updated for surface hierarchy; minor routing/state cleanup.
- **Scan phase progress**: Old gradient progress bar replaced with `PhaseProgressCards` grid in staking scanner tools.
- **README.md font reference corrected**: Was "Sora + JetBrains Mono"; now correctly "Space Grotesk + Inter + JetBrains Mono".
- **DESIGN.md File Structure**: Updated to reflect `docs/new_design/stitch/` mockup directory, `chainInfo.js`, `eraRpc.js`, and `PhaseProgressCards.jsx`.
- **Design mockups**: New reference HTML + screenshots added under `docs/new_design/stitch/` (landing page, era explorer, balance viewer, reward history, staking cadence — both interactive and final variants).
- **`scripts/staking-rewards-rpc.py`**: Minor update (logging / output formatting).
- **`src/hooks/useBalanceExplorer.js`, `useRewardHistory.js`, `src/utils/balanceExport.js`, `src/utils/eraRpc.js`**: Minor fixes carried in from previous feature branches.

---

## Fixes
None

---

## Files Changed

| File | Change |
|---|---|
| `README.md` | Full rewrite: modern badges, accurate tech stack, corrected listings |
| `CLAUDE.md` | Added chainInfo.js, eraRpc.js, PhaseProgressCards.jsx, design files to Key Files table |
| `DESIGN.md` | Added Design System section (Kinetic Ledger); updated File Structure |
| `src/components/PhaseProgressCards.jsx` | **NEW**: SVG ring-progress phase cards |
| `src/index.css` | Extended with design-system utility classes, CSS custom properties, animations |
| `tailwind.config.js` | Full token rebuild aligned to Kinetic Ledger spec |
| `src/App.jsx` | Surface-hierarchy layout classes; minor routing cleanup |
| `src/components/AppHeader.jsx` | Restyled to Kinetic Ledger tokens |
| `src/components/LandingPage.jsx` | Restyled; card grid updated |
| `src/components/ModeSelector.jsx` | Restyled tab bar |
| `src/components/ControlPanel.jsx` | Restyled input + button group |
| `src/components/ValidatorCard.jsx` | Restyled expandable card |
| `src/components/PoolCard.jsx` | Restyled expandable card |
| `src/components/SummarySection.jsx` | Restyled aggregate summary |
| `src/components/PoolSummarySection.jsx` | Restyled aggregate summary |
| `src/components/BalanceExplorer.jsx` | Restyled; layout cleanup |
| `src/components/BalanceChart.jsx` | Chart colors aligned to design tokens |
| `src/components/BalanceTable.jsx` | Restyled table rows/headers |
| `src/components/BalanceExportPanel.jsx` | Restyled export panel |
| `src/components/BalanceImportPanel.jsx` | Restyled import panel |
| `src/components/EraBlockExplorer.jsx` | Restyled stat cards, EKG panel, past-era lookup |
| `src/components/RewardHistoryViewer.jsx` | Restyled compute/import/export panels |
| `src/components/TerminalLog.jsx` | Restyled terminal panel |
| `src/constants.js` | Minor constant updates |
| `src/hooks/useBalanceExplorer.js` | Minor fix |
| `src/hooks/useRewardHistory.js` | Minor fix |
| `src/utils/balanceExport.js` | Minor fix |
| `src/utils/eraRpc.js` | Minor fix |
| `scripts/staking-rewards-rpc.py` | Logging / output formatting update |
| `index.html` | Meta/font link updates |
| `docs/new_design/stitch/*/` | **NEW**: Design mockup HTML + screenshots (8 views) |
| `docs/new_design/stitch/enjinsight_obsidian/DESIGN.md` | Moved from `docs/new_design/DESIGN.md` |
| `docs/technical_reference.md` | **NEW**: Technical reference document |

---

## Testing Notes

**How to Test:**
1. `npm ci && npm run dev` — open http://localhost:5173
2. Navigate to each of the four tools and verify the Kinetic Ledger visual treatment: deep-navy surfaces, no visible 1px borders separating major sections, Space Grotesk headlines, JetBrains Mono addresses/log text
3. Run the Staking Rewards Cadence scan (validator mode) and confirm `PhaseProgressCards` renders ring-progress states correctly: queued (muted), in-progress (cyan + live %), completed (green checkmark)
4. Run a Historical Balance Viewer query and confirm chart colors match the design token palette
5. Run a Reward History computation and confirm the terminal log uses the correct monospace/color treatment
6. `npm run test` — all unit tests should pass
7. `npm run build` — production build should complete with no errors

**Test Coverage:**
- Browsers: Chrome, Firefox, Safari (desktop)
- Devices: desktop (1440px), tablet (768px), mobile (390px)
- Scenarios: all four tools end-to-end, dark theme only, all scan abort/stop flows

---

## Security Considerations

**Security Measures:**
- **No new attack surface**: All changes are UI/styling and documentation — no new API calls, no new user inputs, no new data paths.
- **No `innerHTML` introduced**: All restyled components continue to use React JSX exclusively for rendering.
- **Design tokens only**: Tailwind config changes are purely CSS-variable and class-name; no runtime execution.

---

## Performance Impact
- **PhaseProgressCards uses SVG**: Lightweight, no canvas, no Chart.js dependency. Pure CSS stroke-dashoffset transition.
- **No new npm dependencies** added for the design system; all tokens are Tailwind configuration only.
- **Font swap**: Space Grotesk replaces Sora (comparable weight); loaded via Google Fonts with `display=swap`.
- No significant performance impact.

---

## Breaking Changes
None

---

## Dependencies
None

---

## Follow-up Items
- [ ] Verify WCAG AA contrast for all new design token combinations in automated tooling (axe-core / Lighthouse)
- [ ] Add Vitest snapshot tests for PhaseProgressCards component
- [ ] Consider dark-mode-only Storybook stories for each restyled component
- [ ] Update `docs/ui_design_system.md` to align with the Kinetic Ledger spec (currently documents an older system)

---
