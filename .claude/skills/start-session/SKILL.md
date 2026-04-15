---
name: start-session
description: Initialize a new session — reads the session management workflow, then clears the actions log and PR description from the previous session.
disable-model-invocation: true
---

Follow these steps exactly:

1. Read `.github/ai-instructions.md` in full. This contains the Session Management Workflow — internalize its procedures and guidelines before doing any other work.

2. Delete `.github/actions.md` and `.github/pr_description.md` to start with a clean slate:
   ```
   rm .github/actions.md
   rm .github/pr_description.md
   ```
   If either file does not exist, skip the deletion silently — do not error.

3. Confirm to the user that the session has been initialized and briefly summarize the key workflow guidelines from `.github/ai-instructions.md`.
