## Agent notes

Record the moments listed under "Record" as notes in `{{notes_dir}}` at project scope, each kind in its own folder.
These notes are read later by the user in Obsidian and by future agents deciding how to act, so write them to be scanned: the binding point first, the evidence below it.
The user chose what to record and what to leave out; record only what "Record" asks for, and when a moment also matches "Do not record", leave it out.
When a topic already has a note, update that note instead of starting another.

{{ask_section}}

### Record

{{record_list}}

### Do not record

{{skip_list}}
- Secrets, always: never persist them; write `[REDACTED: <kind>]` in their place.

{{kind_sections}}

### Folders and filenames

- Path: `<kind folder>/<category>/<sub-category>/<detail>.md`, three folders at most counting the kind folder, for example `{{example_path}}`. A note with no sub-category goes in `<kind folder>/<category>/`.
- Before creating a folder, list the folders the notes already use, in every kind, and reuse a matching category or sub-category, so one topic has one name everywhere. Write folder and file names in lowerCamelCase.
- The file name is only the last part (`stateHandling.md`), so the same name can appear in other folders. Link to a note by its path {{link_from}}, with the title as the link text: `{{link_example}}`. A link by name alone may open the wrong note.
- The nested tag in `tags` is the note's category and sub-category folders, for example `proxy/session`.
- Each kind's folder has a `summary.md` listing every note of that kind by category, with its status and last update. After creating or updating a note, add or update its row there in the same format, creating the page the same way if it is missing; the installer rebuilds these pages from the notes' properties.
- The user's explicit naming convention takes precedence over generic filename style rules for these notes.
- Each kind's section lists its required sections, in order. When a section has nothing to say, say so in one line; do not invent content to fill it.

### Note layout

Use only core Obsidian features, so a note reads well with no plugins installed, and let them carry structure and color:

````markdown
---
status: resolved
created: 2026-10-05T14:32:07
updated: 2026-10-05T16:08:41
tags: [challenge, queue/retry]
aliases: ["Retries pile up because the lock outlives the worker"]
implementation:
cssclasses: [agent-note]
---

# Retries pile up because the lock outlives the worker

> [!success|banner] Resolved 2026-10-05 16:08:41
> The job lock now expires with the worker's lease, so a crashed worker no longer blocks its retries.

## 1. Symptom
...
````

- Properties: keep exactly these, because they sit above the banner and every extra row pushes it down. `status` uses the kind's own vocabulary (listed in its section); keep `updated` current; `tags` holds the kind's tag plus a nested `category/subcategory` tag (the tags are what dashboards query); `implementation` holds the summary link once it exists.
- Times: write `created` and `updated` as local date and time to the second, `YYYY-MM-DDTHH:mm:ss`, so notes written on the same day still sort and read in order. Read the clock for every write (for example `date +%Y-%m-%dT%H:%M:%S`); never guess or round a time, and never write a date alone. Any other time in a note (a banner, a quote label) uses the same clock reading, written `YYYY-MM-DD HH:mm:ss`.
- Title: a sentence-case statement a person would search for, not the filename. Repeat it in `aliases`, double-quoted, since an unquoted comma splits it into several aliases.
- Banner: the first block after the title is a callout with `|banner` metadata that states the note's point in one or two sentences. Its type carries the status color, as each kind's section says.
- Callout colors carry meaning, so use each type only for its role: `abstract` for a proposal or the approach before a change, `warning` for what the user changed or rejected and for caveats, `success` for agreed rules and what now holds, `failure` for what was abandoned, `todo` for open follow-ups, `quote` for verbatim messages. Keep the rest as plain prose, tables, and lists; a note where everything is a callout has no emphasis.
- Use a table when several points are compared (options, attempts, proposed vs. changed). Use a `mermaid` diagram only when the content is a flow or state machine, and keep it small enough to read at page width (about eight nodes).
- Link with path `[[wikilinks]]` (see Folders and filenames) to related notes of any kind (a pivot to the dead end that caused it, a challenge to the decision it forced) and other notes in the same vault; use Markdown links with angle-bracketed paths for files outside it. Mark code paths and identifiers with inline code.
- Quote the user verbatim, in a `quote` callout labelled User with the message in a fenced `text` block, whenever their words triggered or decided what the note records. When a message itself contains backticks, make the fence longer than the longest backtick run inside it.

### Writing

- Write so a future agent can act on the note without reading the conversation: present tense, short sentences, one idea per bullet, the user's own terms for project concepts.
- Write prose in the language the user writes in; keep the required section headings as given.
- Distinguish user requirements and operating assumptions from measured observations, implementation status, and validation evidence; label each where it could be confused.
- Never claim something is implemented or verified before it has happened.

### Implementation backlink

- Once the related changes finish implementing, always add a backlink to the saved `$implementation-summary` artifact under a `### Implementation` heading at the end of the note and in the `implementation` property. Prefer a durable Markdown summary link; also link its HTML companion when available. A transient review-session URL alone is insufficient.
- Keep the note's status, banner, `updated`, and summary links current when follow-up work changes the result. When a later note replaces this one, mark this one `superseded` and link both ways.
- Preserve existing project instructions, unrelated notes, and secrets. Follow the project's index and documentation maintenance rules when creating or updating notes.
