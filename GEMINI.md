# Rules for the Agent — Island

> Single source of truth: [`PLAN.md`](PLAN.md#4-rules-for-the-agent-and-autonomous-execution).
> If this file ever differs from `PLAN.md`, **PLAN.md wins**.

1. Read README.md and PLAN.md at the start of every session. Update PLAN.md as you go: checkboxes, status, findings, decisions, phase reports.
2. After the user's single "yes" to Phase 1, follow the Autonomous Execution rules (PLAN.md §4.2). Do not wait for approval between phases.
3. Never invent undocumented formats, selectors or APIs. Investigate first, record the findings in PLAN.md §7, and mark anything uncertain as **UNVERIFIED**.
4. Use git: commit per logical step with clear messages (`phase-N: <what>`). Tag each completed phase `phase-N-complete`. No force pushes, no history rewrites. Ask before any destructive command or global software install.
5. No secrets in the repo or in logs. No conversation or email content in logs or in investigation output.
6. Keep each source in its own module. The event contract (PLAN.md §3) is the only coupling.
7. If blocked on a human step: write the exact steps in PLAN.md §6, mark the item BLOCKED, and move on to independent work.
8. Use Windows paths and PowerShell for commands. Keep README.md and PLAN.md in sync with the code.
9. Main branch must always build. Never commit a broken state.
10. Stop and ask the user **only** for: destructive commands, global software installs, any change outside the project folder, or an ambiguous security decision.
