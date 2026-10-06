### Gotchas and lessons

Record a gotcha in `{{folder}}` when a tool, library, API, platform or part of this codebase behaved in a way a competent engineer would not expect, and knowing it saves time later: a misleading error, an undocumented default, an ordering constraint, a version quirk.
Keep these short, one gotcha per note, with a title that states the rule ("`fetch` ignores `timeout` unless an AbortSignal is passed").

- Tag: `{{tag}}`.
- Sections, in order: `## 1. Gotcha` (one or two sentences: what happens, and when), `## 2. Example` (a minimal reproduction or the exact situation it bit in), `## 3. Do instead` (the safe pattern), `## 4. Source` (where it was hit, with links to the code, docs or upstream issue).
- Status and banner: `current` (`tip`, states the rule), `outdated` (`failure`, says what version or change made it stop applying).
