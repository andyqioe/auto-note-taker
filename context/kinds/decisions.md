### Decisions and tradeoffs

Record a decision in `{{folder}}` when the agent chose between real alternatives on its own judgment and the choice shapes later work: an architecture, a data format, a dependency, an interface, or a deliberate tradeoff such as speed against safety or a scope cut.
Leave out choices the user dictated (they are tactical direction) and choices with only one sensible option.
Write it so the user can overrule it quickly: the banner states the choice and the main thing it gives up.

- Tag: `{{tag}}`.
- Sections, in order: `## 1. Context` (the problem and its constraints), `## 2. Options` (each option considered and its cost; a table when there are three or more), `## 3. Choice`, `## 4. Why` (the deciding factors, and what new information would change the decision), `## 5. Consequences` (what the choice commits the project to, and what was given up).
- Status and banner: `made` (`success`), `proposed` (`question`, the choice waits for the user's sign-off; say what happens meanwhile), `superseded` (`failure`, links the note that replaced it).
- If the user later rejects or reshapes the decision, record that as tactical direction (if it is recorded), mark this note `superseded`, and link both.
