## Tactical direction and disagreements

Always record any user disagreement or tactical direction in `{{notes_dir}}` at project scope.
Record the actual exchange and the final agreement, and update the note as the agreement evolves.
Do not silently replace the user's direction with an agent's preferred policy.
These notes are read later by the user in Obsidian and by future agents deciding how to act, so write them to be scanned: the binding rule first, the evidence below it.

### Filename and sections

- Filename: `[Category]-[Sub-category]-[Sub-sub-category].md`, for example `proxy-session-stateHandling.md`. The user's explicit naming convention takes precedence over generic filename style rules for these notes.
- Required sections, in order: `## 1. Context`, `## 2. Agent Proposal`, `## 3. User Disagreement`, `## 4. Reconciliation`, `## 5. Final agreement`.
- If direction was given without a proposal or disagreement, say so in those sections; do not invent an exchange. If agreement is still pending, record that explicitly.

### Verbatim exchange

- Preserve verbatim copies of the relevant user responses and agent responses in fenced `text` code blocks, each with an explicit User or Agent label, in chronological order. Keep the quoted exchange alongside the summary and reconciliation; do not substitute paraphrases for the copies.
- Put the exchange under `### Exchange (verbatim)` at the end of `3. User Disagreement`. Wrap each message in a `quote` callout whose metadata names the speaker, with the fence inside it. Every line of a callout, including blank lines, starts with `>`. Fold agent messages longer than about 15 lines with `-`; keep user messages open, because they are the direction.
- When a message itself contains backticks, make the fence longer than the longest backtick run inside it (four backticks when the message contains three), so the quote cannot close early.
- Explicitly redact secrets as `[REDACTED: <kind>]` rather than persisting them.

### Note layout

Use only core Obsidian features, so the note reads well with no plugins installed, and let them carry structure and color:

````markdown
---
status: agreed
created: 2026-10-05
updated: 2026-10-05
tags: [tactical-direction, queue/retry]
aliases: ["Retry failed jobs with a fixed delay"]
implementation:
cssclasses: [tactical-direction]
---

# Retry failed jobs with a fixed delay

> [!success|banner] Agreed 2026-10-05
> Retry failed jobs every 30 seconds, at most 5 times; do not use exponential backoff.

## 1. Context
## 2. Agent Proposal
> [!abstract] Proposed
## 3. User Disagreement
> [!warning] User direction
### Exchange (verbatim)
> [!quote|user] User · 2026-10-05
> ```text
> ...
> ```

> [!quote|agent]- Agent · 2026-10-05
> ```text
> ...
> ```
## 4. Reconciliation
## 5. Final agreement
> [!success] Agreed rules
> 1. ...
### Implementation
````

- Properties: keep exactly these, because they sit above the banner and every extra row pushes it down. `status` is `agreed`, `pending`, or `superseded`; keep `updated` current; `tags` holds `tactical-direction` plus a nested `category/subcategory` tag (the tag is what dashboards query); `implementation` holds the summary link once it exists.
- Title: a sentence-case decision statement a person would search for, not the filename. Repeat it in `aliases`, double-quoted, since an unquoted comma splits it into several aliases.
- Banner: the first block after the title is a callout with `|banner` metadata that states the binding rule in one or two sentences. Its type carries the status color: `success` for agreed, `question` for pending (say what is undecided and who decides), `failure` for superseded (link the newer note).
- Callout colors carry meaning, so use each type only for its role: `abstract` for the agent's proposal, `warning` for what the user changed or rejected, `success` for the agreed rules, `todo` for open follow-ups, `quote` for verbatim messages. Keep the rest as plain prose, tables, and lists; a note where everything is a callout has no emphasis.
- Use a table in `4. Reconciliation` when several points changed (proposed, changed to, why). Use a `mermaid` diagram only when the agreement is a flow or state machine, and keep it small enough to read at page width (about eight nodes).
- Link with `[[wikilinks]]` to related tactical-direction notes and other notes in the same vault; use Markdown links with angle-bracketed paths for files outside it. Mark code paths and identifiers with inline code.

### Writing

- Write so a future agent can act on the note without reading the exchange: present tense, short sentences, one idea per bullet, the user's own terms for project concepts.
- Write prose in the language the user writes in; keep the required section headings as given.
- Number the agreed rules in `5. Final agreement` and make each one testable.
- Distinguish user requirements and operating assumptions from measured observations, implementation status, and validation evidence; label each where it could be confused.

### Implementation backlink

- Once the related changes finish implementing, always add a backlink to the saved `$implementation-summary` artifact under `### Implementation` and in the `implementation` property. Prefer a durable Markdown summary link; also link its HTML companion when available. A transient review-session URL alone is insufficient.
- Keep the note's implementation status, banner, `status`, `updated`, and summary links current when follow-up work changes the result. When a later agreement replaces this one, mark it `superseded` and link both notes. Never claim implementation or verification before it has happened.
- Preserve existing project instructions, unrelated notes, and secrets. Follow the project's index and documentation maintenance rules when creating or updating notes.
