### Challenges and how they were overcome

Record a challenge in `{{folder}}` when a problem took real effort to solve: a bug whose cause was not obvious, a fix that needed several attempts, an environment or tooling obstacle, a performance or correctness problem.
The value is the reasoning: why the fix works and why it was chosen over the alternatives, so the next agent does not rediscover it the hard way.

- Tag: `{{tag}}`.
- Sections, in order: `## 1. Symptom` (what was observed, the exact error text in a fenced block, how to reproduce it), `## 2. Root cause` (what was actually wrong and how it was found; label hypotheses that were never confirmed), `## 3. What was tried` (attempts that did not work, one line each with why; a table when there were several), `## 4. Fix` (what changed, with code paths), `## 5. Why this fix` (why it addresses the root cause rather than the symptom, and which alternatives were rejected and why), `## 6. Verification` (what ran and what it showed; say so plainly when the fix is unverified).
- Status and banner: `resolved` (`success`, states the cause and the fix in one or two sentences), `workaround` (`warning`, says what the real fix would be and why it was not done), `open` (`question`, says what blocks it).
- When the problem made the work change course, also record the pivot (if pivots are recorded) and link both notes.
