# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |

## Reporting a Vulnerability

Do not open a public issue for security findings.

Report privately via:

1. GitHub private vulnerability reporting (Security tab)
2. Direct maintainer contact (GitHub profile)

Please include:

- A clear description of the issue
- Reproduction steps
- Impact assessment
- Suggested fix (if available)

Target response times:

- Initial triage: within 72 hours
- Fix plan for confirmed high/critical issues: within 14 days

## Security Model (Current App)

This project is a read-only monitoring UI with a serverless proxy.

### Frontend Hardening

- No wallet integration or private key handling
- No `dangerouslySetInnerHTML`
- Client-side input validation for scan limits
- BigInt arithmetic for planck/ENJ conversion
- Sanitized display for addresses and labels

### API & Proxy Hardening

- Subscan endpoint paths are allowlisted in `src/constants.js`
- Production proxy target URLs must be HTTPS
- Hostname allowlist is controlled through `PROXY_ALLOWLIST`
- Optional shared secret via `PROXY_SECRET`
- Hop-by-hop and sensitive response headers are stripped

## In Scope

- XSS/injection risks in rendered API data
- Proxy bypass / SSRF-style forwarding abuse
- Authentication/authorization flaws in proxy secret handling
- Dependency vulnerabilities with realistic exploit paths

## Out of Scope

- Upstream Subscan outages or rate limits
- Social engineering and credential phishing
- Infrastructure outside this repository

## Deployed Instance

Primary deployment:

- https://enjinsight.vercel.app/

For deployment-specific issues, include:

- Exact URL
- Timestamp (with timezone)
- Sample request/response (redacted where needed)
