# Custom Prompts

# Start Session

**START OF INSTRUCTIONS**

- When starting a session, read the Session Management Workflow section in `.github/ai-instructions.md` to understand the procedures and guidelines for managing sessions effectively.
- Delete the content of `.github/actions.md` and `.github/pr_description.md` to start a new session with a clean slate. This will help in keeping the records organized and relevant to the current session, avoiding any confusion with previous sessions' data.
- Use these commands to clear the content of the files:
  - `echo "" > .github/actions.md`
  - `echo "" > .github/pr_description.md`

**END OF INSTRUCTIONS**

---

# Create Logs

**START OF INSTRUCTIONS**

Entry format for `.github/actions.md`:

```markdown
# Action: [Short descriptive title]
Timestamp: [YYYY-MM-DD HH:MM:SS UTC] Fetch the current time programmatically using this command: date -u +"%Y-%m-%d %H:%M:%S UTC"

## Changes Made
- [Detailed description of changes]
- [Another change if applicable]

## Files Modified
- `path/to/file1.js` - [brief description]
- `path/to/file2.css` - [brief description]

## Rationale
[Why these changes were made - business/technical reasoning]

## Technical Notes
- [Important implementation details]
- [Security considerations]
- [Performance implications]
- [Dependencies or follow-up items]

---
```

- Read the current content of `.github/actions.md` to understand which actions have already been logged and to avoid duplication of records. This will ensure that the log remains accurate and up-to-date with the latest changes and actions taken during the session.
- Compare the local codebase with the remote repository main branch and generate a log of changes in `.github/actions.md`. Use the `echo` or `printf` command when doing so. Do not use the heredoc. Use the GitHub MCP to access the repository and retrieve the necessary information.
- Make sure all the actions taken in this session including the changes, fixes, and additions made to the codebase are recorded in `.github/actions.md` (use the `printf` command). This log should be comprehensive and provide a clear overview of the work done during this session.

**END OF INSTRUCTIONS**

---

# Create PR Description

**START OF INSTRUCTIONS**

#### Step 1: Read Session Actions
- Read entire contents of `.github/actions.md`

#### Step 2: Generate Semantic Branch Name
Analyze all logged actions and create branch name:

**Branch Prefix Rules:**
- `feature/` - New functionality or capabilities
- `fix/` - Bug fixes or corrections
- `refactor/` - Code restructuring without feature changes
- `chore/` - Maintenance tasks (dependencies, configs)
- `docs/` - Documentation-only changes
- `security/` - Security improvements or patches

**Format:** `[prefix]/[kebab-case-description]`

**Examples:**
- `feature/add-virustotal-integration`
- `feature/implement-ipfs-support`
- `fix/resolve-xss-vulnerability`
- `fix/correct-metadata-parsing-error`
- `refactor/improve-url-validation-logic`
- `chore/update-eslint-configuration`
- `security/implement-csp-headers`

**Guidelines:**
- Keep under 50 characters
- Be specific but concise
- Use descriptive verbs (add, implement, fix, improve, etc.)
- Avoid redundant words (the, a, an)

#### Step 3: Generate Git Commit Message
Create one-line summary following Conventional Commits format:

**Format:** `[type]([scope]): [description]`

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code refactoring
- `chore` - Maintenance
- `docs` - Documentation
- `security` - Security improvement
- `perf` - Performance improvement
- `test` - Testing

**Guidelines:**
- Use imperative mood ("Add" not "Added" or "Adds")
- Keep under 72 characters
- No period at the end
- Lowercase description

**Examples:**
- `feat(scanner): add VirusTotal API integration for URL scanning`
- `fix(validation): prevent XSS in metadata display`
- `refactor(ui): improve status display component structure`
- `security(csp): implement strict Content Security Policy`
- `chore(deps): update development dependencies to latest`

#### Step 4: Check GitHub Issues
- Search repository for existing GitHub Issues
- Identify issues addressed by logged actions
- Look for keywords: bug, feature request, enhancement, security
- Match action descriptions to issue titles/descriptions

#### Step 5: Generate PR Description
Create comprehensive PR description and append to `.github/pr_description.md`:

**PR Description Format:**
```markdown
# PR: [Descriptive title summarizing all changes]
Timestamp: [YYYY-MM-DD HH:MM:SS UTC] Fetch the current time programmatically using this command: date -u +"%Y-%m-%d %H:%M:%S UTC"
Git Branch: [semantic-branch-name]
Git Commit Message: [concise one-liner commit message]

## Summary
[2-3 sentence overview of what this PR accomplishes, why it matters, and the value it provides to users or the project]

## Related Issues
[List GitHub Issues this PR addresses. If none found, write "None"]
- Closes #123
- Fixes #145  
- Related to #162

## Added Features
[List new functionality or capabilities. If none, write "None"]
- [Feature description with user benefit]
- [Another feature if applicable]

## Changes
[List modifications to existing functionality or refactoring. If none, write "None"]
- [Change description with reasoning]
- [Improvement description]

## Fixes
[List bugs or issues resolved. If none, write "None"]
- [Bug fix description with impact]
- [Security vulnerability addressed]

## Files Changed
- `path/to/file1.js` - [description of changes and purpose]
- `path/to/file2.css` - [description of changes and purpose]
- `path/to/file3.html` - [description of changes and purpose]

## Testing Notes
[Testing approach and verification steps]

**How to Test:**
1. [Step-by-step instructions]
2. [Expected results]
3. [Edge cases to verify]

**Test Coverage:**
- [Browsers tested]
- [Devices tested]
- [Scenarios validated]

## Security Considerations
[Security-related changes, validations, or OWASP categories addressed]

**Security Measures:**
- [OWASP category]: [How addressed]
- [Vulnerability fixed]: [Mitigation approach]

**If no security changes:** "No security changes in this PR"

## Performance Impact
[Performance implications, if any]
- [Improvements made]
- [Trade-offs considered]
- [Metrics affected]

**If no impact:** "No significant performance impact"

## Breaking Changes
[List any breaking changes. If none, write "None"]
- [What changed]
- [Migration path]

## Dependencies
[New dependencies added or updated. If none, write "None"]
- `package@version` - [Why added/updated]

## Follow-up Items
[Tasks or improvements for future PRs. If none, write "None"]
- [ ] [Task description]
- [ ] [Future enhancement]

---
```

**Important PR Description Rules:**
- Use **actual current timestamp** (never placeholders)
- Always **append to end of file** (never modify existing entries)
- Synthesize and summarize all actions from `.github/actions.md`
- Be comprehensive but concise
- Write for human reviewers (clear, professional, helpful)
- Include separator line (`---`) as part of template
- Explicitly write "None" for empty sections (don't leave blank)

**Response Format:**
```
✓ PR Description Generated

Branch: [semantic-branch-name]
Commit: [commit-message]
Issues: [count] related issue(s) found

PR description saved to .github/pr_description.md

Next Steps:
  1. Review the PR description
  2. Create branch: git checkout -b [branch-name]
  3. Stage changes: git add .
  4. Commit: git commit -m "[commit-message]"
  5. Push: git push origin [branch-name]
  6. Create PR using description from .github/pr_description.md
```

**END OF INSTRUCTIONS**

---