<p align="center">
  <strong style="font-size:28px">Enjin Validator Reward Checker</strong>
</p>

<p align="center">
  <!-- Repository badges (auto-update once pushed) -->
  <a href="https://github.com/bladzv/enjin-status-checker/actions"><img src="https://img.shields.io/github/actions/workflow/status/bladzv/enjin-status-checker/ci.yml?branch=main&label=CI&logo=github" alt="CI status" /></a>
  <a href="https://github.com/bladzv/enjin-status-checker/actions"><img src="https://img.shields.io/github/actions/workflow/status/bladzv/enjin-status-checker/ci.yml?branch=main&label=Tests&logo=vitest" alt="tests status" /></a>
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
git clone https://github.com/YOUR_USERNAME/enjin-validator-checker.git
cd enjin-validator-checker
npm ci
npm run dev
```

Open `http://localhost:5173`. Configure your proxy URL via the ⚙ gear in the top-right before running checks.

Run unit tests:

```bash
npm run test
```

Create a production build:

```bash
npm run build
```

---

## Project Structure

Short summary of the source layout and responsibilities:

```
src/
├── components/        # Presentational UI components (one component per file)
├── hooks/             # Custom hooks with side-effects and orchestrators
├── utils/             # Utilities: api, formatters, era analysis, proxy probe
├── constants.js       # Centralised configuration and endpoints
├── App.jsx            # Root application component
├── main.jsx           # App entry + bootstrapping
└── index.css          # Tailwind and global styles
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
