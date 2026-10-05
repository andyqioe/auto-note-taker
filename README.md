# Auto Note Taker

Installs persistent instructions into a project's `AGENTS.md`: record every user disagreement and tactical direction as an Obsidian note named `[Category]-[Sub-category]-[Sub-sub-category].md`, with the five required sections, verbatim user and agent messages in speaker-labelled fenced `text` blocks, and a backlink to the completed implementation summary.

The installed instructions are a prompt, not a skill.
An agent must read and follow them to create notes.
The package has no dependencies, lifecycle scripts, network calls, or model calls, and it does not install the separate `implementation-summary` skill.

## Install

Run it in a terminal (Node.js 18+ and Git required) and pick the folders interactively:

```sh
npx --yes github:andyqioe/auto-note-taker
```

The wizard asks for:

1. **Project**: the current folder, a folder you browse to, or a typed path.
2. **Notes folder**: inside the project, any Obsidian vault it finds on this machine, a folder you browse to, or a typed path. In the browser, type to filter, press enter or → to open a folder, ← to go up, and choose "Use this folder" or "New folder here".
3. **Obsidian styling**: offered when the notes folder is inside a vault (see below).
4. **Confirmation**: shows what will change before anything is written.

At the end it prints the equivalent command, so the same install can be repeated without prompts.

To skip the wizard, pass both paths, or `--yes` to take defaults for anything missing:

```sh
npx --yes github:andyqioe/auto-note-taker --project /path/to/project --notes-dir '/path/to/vault/Project/Tactical Direction'
```

Without a terminal (CI, pipes) or with `--check`, the installer never prompts.
The default notes folder is `Tactical Direction`, relative to the project.
Notes inside the project are recorded with a project-relative path.

This repository is private; your local Git must already have access to it.
Credentials are handled by Git, never by the installer.
For reproducible installation, pin a reviewed commit with `github:andyqioe/auto-note-taker#COMMIT_SHA`.

## What the notes look like

The instructions use core Obsidian features only, so notes read well without plugins:

- **Properties**: `status` (`agreed`, `pending`, `superseded`), `created`, `updated`, a `tactical-direction` tag plus a nested `category/subcategory` tag, the decision title in `aliases`, the `implementation` summary link, and `cssclasses: [tactical-direction]`.
- **Banner**: the first block is a callout stating the binding rule, colored by status: green when agreed, yellow when pending, red when superseded.
- **Color with meaning**: `abstract` for the agent's proposal, `warning` for what the user changed, `success` for the numbered agreed rules, `todo` for open follow-ups.
- **Verbatim exchange**: each message sits in a `quote` callout tagged `|user` or `|agent`, with long agent replies folded.
- **Writing**: a searchable decision-statement title, present tense, one idea per bullet, prose in the user's language, and labels that separate requirements and assumptions from measured evidence.

## Obsidian styling and dashboard

When the notes folder is inside a vault, the wizard offers to add (or pass `--obsidian-extras`):

- `.obsidian/snippets/tactical-direction.css`, enabled in `.obsidian/appearance.json`. It turns the status callout into a banner, shows the filename as a quiet slug, underlines the numbered sections, and styles the exchange as a chat with user and agent icons. It only affects notes with the `tactical-direction` class.
- `Tactical Direction.base` in the notes folder: a Bases dashboard of every decision grouped by status, plus an "Open" view of pending ones.

The installer never overwrites a snippet you have edited (delete its first comment line to take ownership) or an existing dashboard.
If a running Obsidian does not pick up the snippet, reopen the vault.

## Maintenance

From a clone, installation runs entirely offline:

```sh
node bin/install.mjs --project /path/to/project --notes-dir 'Tactical Direction'
node bin/install.mjs --project /path/to/project --check
npm test
```

The installer only adds or updates its marked instructions block, preserves other text, and follows an `AGENTS.md` symlink only when its target is inside the project.
Run it in the owning vault project for external symlinks.
`--check` reports whether the managed block matches, without writing.
Repeating installation is idempotent.

To uninstall, remove the block between `BEGIN tactical-direction-context` and `END tactical-direction-context` from your project instructions; existing notes remain.
Remove the snippet and `Tactical Direction.base` by hand if you added them.

For a portable local package, run `npm pack` in this directory, then use its `.tgz` path with `npx --package /path/to/package.tgz auto-note-taker ...`.
No npm registry release has been published; GitHub installation works without one.
