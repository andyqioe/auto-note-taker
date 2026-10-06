### Tactical direction and disagreements

Record every user disagreement or tactical direction in `{{folder}}`: a proposal the user rejected or reshaped, a working rule they set ("use pnpm, never npm"), or a question they deliberately left open.
Record the actual exchange and the final agreement, and update the note as the agreement evolves.
Do not silently replace the user's direction with an agent's preferred policy.

- Tag: `{{tag}}`.
- Sections, in order: `## 1. Context`, `## 2. Agent Proposal`, `## 3. User Disagreement`, `## 4. Reconciliation`, `## 5. Final agreement`.
- If direction was given without a proposal or disagreement, say so in those sections; do not invent an exchange. If agreement is still pending, record that explicitly.
- Status and banner: `agreed` (`success`, states the binding rule), `pending` (`question`, says what is undecided and who decides), `superseded` (`failure`, links the newer note).
- Number the agreed rules in `5. Final agreement` inside a `success` callout, and make each one testable. Use a table in `4. Reconciliation` when several points changed (proposed, changed to, why).

#### Verbatim exchange

- Preserve verbatim copies of the relevant user responses and agent responses in fenced `text` code blocks, each with an explicit User or Agent label, in chronological order. Keep the quoted exchange alongside the summary and reconciliation; do not substitute paraphrases for the copies.
- Put the exchange under `### Exchange (verbatim)` at the end of `3. User Disagreement`. Wrap each message in a `quote` callout whose metadata names the speaker (`> [!quote|user] User · 2026-10-05`, `> [!quote|agent]- Agent · 2026-10-05`), with the fence inside it. Every line of a callout, including blank lines, starts with `>`. Fold agent messages longer than about 15 lines with `-`; keep user messages open, because they are the direction.
- The agent's proposal goes in an `abstract` callout under `2. Agent Proposal`, and what the user changed in a `warning` callout under `3. User Disagreement`.
