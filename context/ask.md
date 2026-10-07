### Ask before writing

Before creating or updating a note, ask the user with an explicit Yes/No selector in your UI (a multiple-choice question tool, such as AskUserQuestion, with exactly the options Yes and No), not a question buried in prose.
Name the kind, the title and the file path in the question, so the user can decide without opening anything.
Write the note only on Yes. On No, leave it unwritten and do not ask again about the same moment.
Ask once the moment is settled, not mid-step. When several notes are pending, give each its own Yes/No question in the same prompt when the tool allows it.
If no user can answer (a non-interactive run), do not write the note.
