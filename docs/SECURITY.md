# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Yes     |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please **do not** open a
public GitHub issue. Instead, report it privately:

1. Email the repository owner directly (see profile), or
2. Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) feature.

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations

We aim to respond within **72 hours** and to publish a fix within **14 days** for
confirmed high/critical issues.

## Scope

In-scope:
- XSS or injection via API data rendering
- CORS proxy bypass or SSRF
- Input validation bypass
- Dependency vulnerabilities with active exploits

Out-of-scope:
- Denial of service via API flooding (mitigated by batch size; Subscan rate limiting applies)
- Social engineering
- Physical security
