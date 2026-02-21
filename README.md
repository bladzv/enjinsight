<p align="center">
  <strong style="font-size:28px">Enjin Status Checker</strong>
</p>

<p align="center">
  <!-- Repository badges (auto-update once pushed) -->
  <a href="https://github.com/bladzv/enjin-status-checker/actions"><img src="https://img.shields.io/github/actions/workflow/status/bladzv/enjin-status-checker/ci.yml?branch=main&label=CI&logo=github" alt="CI status" /></a>
  <a href="https://github.com/bladzv/enjin-status-checker/actions"><img src="https://img.shields.io/github/actions/workflow/status/bladzv/enjin-status-checker/ci.yml?branch=main&label=Tests&logo=vitest" alt="tests status" /></a>
  <a href="https://github.com/bladzv/enjin-status-checker/actions"><img src="https://img.shields.io/github/actions/workflow/status/bladzv/enjin-status-checker/deploy.yml?branch=main&label=Deploy&logo=github" alt="deploy status" /></a>
  <a href="https://github.com/bladzv/enjin-status-checker"><img src="https://img.shields.io/github/license/bladzv/enjin-status-checker" alt="license" /></a>
</p>

A fast, accessible, and secure static web application to monitor validator reward cadence on the Enjin Relaychain. The app fetches validator and era statistics from Subscan (via a CORS proxy) and surfaces missing/rewarded eras, nominator details, and aggregate summaries.

---

## Key Features

- Fetch validator data and era rewards from Subscan (via allowlisted CORS proxy)
- Detect and highlight missing eras and consecutive gaps per validator
- Per-validator nominator lists and expanded era history
- Live terminal-style operational log for transparency of background API activity
- Progressive rendering, network-aware batching, and mobile-first responsive UI
- Security-first defaults: BigInt planck handling, strict proxy allowlist, and sanitized logs

---

## Quick Start (Local Development)

Clone and run locally:

```bash
git clone https://github.com/bladzv/enjin-status-checker.git
cd enjin-status-checker
npm ci
npm run dev
```

Open `http://localhost:5173`. Configure your proxy URL via the ⚙ gear in the top-right before running checks.

If `npm ci` fails due to Node version mismatch, install Node 18 (recommended) and try again. Example using `volta`:

```bash
# Install Node 18 via Volta (recommended for contributors)
volta install node@18
npm ci
```

Run unit tests:

```bash
npm run test
```

Create a production build:

```bash
npm run build
```

Deploy options (choose one):

- GitHub Actions (recommended): The repository already contains `.github/workflows/deploy.yml` which builds and deploys the `dist` artifact to GitHub Pages automatically on pushes to `main`. Ensure GitHub Pages site source is set to "GitHub Actions" in repository Settings → Pages.

- `gh-pages` (manual/npm): Publish the `dist` folder to the `gh-pages` branch using `gh-pages`:

```bash
npm ci
npm run deploy
```

- `docs/` folder (commit-built): Build and copy `dist` into `docs/` and commit (useful if you prefer serving from `main/docs`):

```bash
npm run build
# remove previous docs contents, copy in new build, then commit
rm -rf docs/*
cp -r dist/* docs/
git add docs
git commit -m "chore(build): publish site to docs/"
git push
```

Notes:
- Do not serve the raw repository `index.html` from the repo root — it references source modules (`/src/main.jsx`) and will 404 on GitHub Pages. Always serve a built `dist` or `docs/` copy.
- This repo includes a `.nojekyll` file to prevent Jekyll processing on GitHub Pages.

---

## Project Structure

Repository layout (root-level overview):

```
./
├── README.md
├── LICENSE
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── vite.config.js
├── PROXY.md
├── public/             # Static assets served as-is
├── docs/               # Product docs, deployment notes, security
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── constants.js
│   ├── index.css
│   ├── components/     # Presentational UI components (one component per file)
│   ├── hooks/          # Custom hooks with side-effects and orchestrators
│   └── utils/          # Utilities: api, formatters, era analysis, proxy probe
└── .github/
  ├── workflows/      # GitHub Actions workflows (CI / deploy)
  └── (session files)
```

Notes:
- Keep components small and focused (max ~300 lines/file, 50 lines/function).
- All network paths and timeouts live in `src/constants.js`.

---

## CORS Proxy

The Subscan API prevents direct browser requests. Deploy the recommended Cloudflare Worker in `PROXY.md` and use the Worker URL in the app proxy settings. The proxy enforces an upstream allowlist and validates the `Origin` header.

---

## Security

- No `dangerouslySetInnerHTML` — API strings are rendered via JSX (auto-escaped).
- Use `BigInt` for Planck unit arithmetic and only convert for display in `src/utils/format.js`.
- Client validates era count (1–100) before sending requests.
- Terminal logs are sanitized and never include raw upstream errors or full stash addresses.
- CI enforces `npm audit` checks and blocks high-severity vulnerabilities.

See `SECURITY.md` and `enjin_validator_reward_checker_PRD.md` for the full security model.

---

## Contributing

Contributions are welcome. Please open issues or PRs; follow the existing code style and keep changes small and focused. Run tests and the build locally before submitting.

---

## License

This project is licensed under the MIT License — see `LICENSE` for details.
