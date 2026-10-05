## Tactical direction and disagreements

Always record any user disagreement or tactical direction in `{{notes_dir}}` at project scope. Record the actual exchange and the final agreement; update the relevant note as the agreement evolves. Do not silently replace the user's direction with an agent's preferred policy.

- Filename: `[Category]-[Sub-category]-[Sub-sub-category].md`, for example `proxy-session-stateHandling.md`. The user's explicit naming convention takes precedence over generic filename style rules for these notes.
- Required sections, in order: `1. Context`, `2. Agent Proposal`, `3. User Disagreement`, `4. Reconciliation`, `5. Final agreement`.
- Preserve verbatim copies of the relevant user responses and agent responses in fenced `text` code blocks, with an explicit User or Agent label and chronological ordering. Keep the quoted exchange alongside the summary and reconciliation; do not substitute paraphrases for the copies. Explicitly redact secrets rather than persisting them.
- If direction was given without a proposal or disagreement, say so in those sections; do not invent an exchange. If agreement is still pending, record that explicitly.
- Distinguish user requirements and operating assumptions from measured observations, implementation status, and validation evidence.
- Once the related changes finish implementing, always add a backlink in the tactical-direction note to the saved `$implementation-summary` artifact. Prefer a durable Markdown summary link; also link its HTML companion when available. A transient review-session URL alone is insufficient.
- Keep the note's implementation status and summary links current when follow-up work changes the result. Never claim implementation or verification before it has happened.
- Preserve existing project instructions, unrelated notes, and secrets. Follow the project's index and documentation maintenance rules when creating or updating notes.
