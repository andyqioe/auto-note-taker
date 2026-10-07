---
status: agreed
created: 2026-10-05T14:48:53
updated: 2026-10-05T14:56:08
tags: [tactical-direction, dependencies/package-manager]
aliases: ["Use pnpm only, pin exact dependency versions, and commit lockfile changes separately"]
implementation:
cssclasses: [agent-note]
---

# Use pnpm only, pin exact dependency versions, and commit lockfile changes separately

> [!success|banner] Agreed 2026-10-05 14:56:08
> In `atlas-web`, use `pnpm` only, never `npm` or `yarn`.
> Pin exact versions for every dependency you add (no `^` or `~`), and put lockfile changes in their own commit.

## 1. Context

- Project: `atlas-web`.
- On 2026-10-05 the user gave standing direction ("from now on") for how dependencies are managed in this repo.
- The direction was unprompted.
It did not respond to an earlier agent proposal, and no implementation has happened yet.

## 2. Agent Proposal

No agent proposal preceded the direction.
The user stated the rules first; the agent only acknowledged them.

In its acknowledgement, the agent also volunteered scope the user did not ask for:

> [!abstract] Proposed
> Switch the README install instructions and the CI setup step to `pnpm` as part of the next change.

The user did not reply to this addition, so it is an agent commitment, not user direction.
It is tracked as a follow-up in section 5.

## 3. User Disagreement

There was no disagreement.
The user gave direction, and the agent accepted it unchanged.

> [!warning] User direction
> - Use `pnpm` in this repo, never `npm` or `yarn`.
> - Pin exact versions when adding dependencies: no `^` or `~`.
> - Lockfile changes go in their own commit.

### Exchange (verbatim)

> [!quote|user] User · 2026-10-05 14:48:53
> ```text
> from now on use pnpm in this repo, never npm or yarn. and pin exact versions when you add deps, no ^ or ~. lockfile changes go in their own commit
> ```

> [!quote|agent] Agent · 2026-10-05 14:50:16
> ```text
> Will do: pnpm only, exact versions for new dependencies, and lockfile changes in a separate commit. I'll switch the README install instructions and the CI setup step to pnpm as part of the next change.
> ```

## 4. Reconciliation

Nothing needed reconciling; the agreed rules are the user's direction as given.

Scope notes, so future agents do not widen or narrow the direction:

- The pinning rule covers dependencies the agent **adds**.
The user did not ask to rewrite existing `^` or `~` ranges already in `package.json`; do not do that without asking.
- "Lockfile" means `pnpm-lock.yaml` under this direction.
- Interpretation (agent, not confirmed by the user): read "lockfile changes go in their own commit" literally, so the commit that changes the lockfile contains only the lockfile.
The matching `package.json` edit goes in a separate commit.

## 5. Final agreement

> [!success] Agreed rules
> 1. Every package-manager command in `atlas-web` uses `pnpm`; no `npm` or `yarn` command is run, and no `npm`/`yarn` command is introduced into scripts, docs, or CI that the agent writes.
> 2. Every dependency the agent adds is written to `package.json` with an exact version, with no `^` or `~` prefix (for example via `pnpm add --save-exact`).
> 3. Any change to the lockfile lands in a commit that contains no other file changes.

> [!todo] Open follow-ups
> - Agent commitment, not user-requested: switch the README install instructions and the CI setup step to `pnpm` in the next change. Status: not started.
> - Unconfirmed: whether the user wants `package.json` edits allowed in the same commit as the lockfile. Until the user says otherwise, follow rule 3 literally.

### Implementation

Not implemented yet.
No changes have been made as of 2026-10-05.
