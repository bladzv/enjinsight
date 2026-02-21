# Copilot Instructions for Enjin Validator Reward Checker

These notes are aimed at any AI coding agent that needs to be immediately productive in this repository.  They are **project‑specific** and contain the essential architecture, workflows and conventions you will encounter.

## Big‑Picture Architecture

- **Static frontend only.**  There is no server component other than a separate CORS proxy (see `PROXY.md`).  All business logic runs in the browser.
- **Frameworks:** React 18 with Vite 5 (see `vite.config.js`), TailwindCSS v3 for styling and Lucide‑React for icons.  The app is built for GitHub Pages/Netlify/Vercel or any static host.
- **Data flow:** user enters era count → `src/hooks/useValidatorChecker.js` dispatches actions to a reducer → `src/utils/api.js` performs POSTs to the Subscan API (paths defined in `src/constants.js`) → results (validators, nominators, era stats) are batched via `runInBatches()` and reduced into state → `src/components/*` render cards, tables and the terminal log progressively.
- **State management:** local `useReducer`/`useCallback` inside the custom hook; no external store.  Reducer actions are dispatched per‑validator to allow partial rendering and error isolation.

## Key Directories & Files

```
src/
├── components/        # React UI components (one file per component)
├── hooks/             # custom hooks containing side‑effects and reducer logic
├── utils/
│   ├── api.js         # HTTP wrapper with proxy allowlist, batching, timeout
│   ├── format.js      # BigInt Planck formatting, address truncation
│   └── eraAnalysis.js # algorithms for missed‑era detection and severity
└── constants.js       # all URLs, timeouts, batch sizes, limits, etc.
```

The `utils/api.js` module enforces a strict allowlist and never exposes raw errors; study it for request patterns.

## Development Workflows

- **Start dev server:** `npm run dev` (Vite HMR)
- **Build for production:** `npm run build`; verify `sourcemap: false` and no `.map` files post‑build.
- **Preview build locally:** `npm run preview`
- **Linting:** `npm run lint` (ESLint with React & hooks plugins, no warnings allowed).

Dependencies are pinned; CI uses `npm ci`.  Dependabot and `npm audit --audit-level=high` are required by the GitHub Actions deploy workflow.

## Conventions & Patterns

- **Constants first.**  Every configuration value (API endpoints, timeouts, batch size) lives in `src/constants.js`.  Never hard‑code strings or numbers elsewhere.
- **BigInt everywhere.**  On‑chain ENJ values are Planck (10¹⁸) and must be handled with `BigInt`.  Conversion to human‑readable strings occurs only in `format.js` or at render time.
- **Address truncation.**  Use `truncateAddress()` from `format.js` for logs and UI; do not expose full stash addresses in logs or errors.
- **Allowlist enforcement.**  `api.buildUrl()` throws if the requested path is not in `ENDPOINTS` and validates the proxy URL as HTTPS.
- **Batching.**  `runInBatches(tasks, batchSize)` processes API tasks in serial groups to avoid rate‑limits.  Batch size halved on 2G/3G connections.
- **Icon imports.**  Import individual Lucide icons (`import { ExternalLink } from 'lucide-react'`) to keep bundles small; never import the entire library.
- **Component limits.**  Max 50 lines per function, 300 lines per file; single responsibility enforced.
- **Accessibility.**  Buttons have `aria-label`, focus rings use Tailwind `focus-visible:ring`, terminal log has `aria-live="polite".

## Session Management & PR Template Guidance

Most of the workflow details — including `START`/`LOG`/`SUCCESS`/`END` commands and the exact formats/templates for entries in `.github/actions.md` and `.github/pr_description.md` — are documented in `.github/ai-instructions.md`.  Always refer to that file for the authoritative session management workflow and entry templates rather than relying on summaries here.
