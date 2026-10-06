### Open questions and assumptions

Record an open question in `{{folder}}` when work goes ahead on an assumption nobody confirmed, or a question comes up that only the user, a measurement or a third party can settle.
These notes prevent wrong turns only if they exist before the turn, so write one as soon as the assumption is made, not after the work is done.

- Tag: `{{tag}}`.
- Sections, in order: `## 1. Question` (one answerable sentence), `## 2. Current assumption` (what the work assumes meanwhile, and the code paths that bake it in), `## 3. Why it matters` (what breaks, or must be redone, if the assumption is wrong), `## 4. Who decides` (the user, a measurement, a third party), `## 5. Answer` (empty until settled; then the answer, who gave it and when, quoting the user when it was them).
- Status and banner: `open` (`question`, restates the question and the assumption in force), `answered` (`success`, states the answer and whether the assumption held), `obsolete` (`failure`, says why the question no longer matters).
- When the answer contradicts the assumption, list under `5. Answer` what has to change, and link the notes that record the change.
