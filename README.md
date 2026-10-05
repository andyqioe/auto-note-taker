# Auto Note Taker

Installs persistent instructions into a project's `AGENTS.md`: record every user disagreement and tactical direction, use `[Category]-[Sub-category]-[Sub-sub-category].md` and the five required sections, preserve verbatim user and agent responses in speaker-labelled fenced `text` blocks, and backlink the completed implementation summary.

This package has no dependencies, lifecycle scripts, network calls, or model calls. It installs instructions; an agent must read and follow them to create notes. It does not install the separate `implementation-summary` skill.

Install directly from GitHub (Node.js 18+ and Git required):

```sh
npx --yes github:andyqioe/auto-note-taker --project /path/to/project
```

To install into the current project, use `--project .`. This repository is private;
your local Git must already have access to it. Credentials are handled by Git,
never by the installer. For reproducible installation, pin a reviewed commit:

```sh
npx --yes github:andyqioe/auto-note-taker#COMMIT_SHA --project .
```

From a clone of this repository, installation can run entirely offline:

```sh
node bin/install.mjs --project /path/to/project --notes-dir 'Tactical Direction'
node bin/install.mjs --project /path/to/project --check
npm test
```

Choose a shared notes directory during GitHub installation:

```sh
npx --yes github:andyqioe/auto-note-taker --project /path/to/project --notes-dir '/path/to/vault/Project/Tactical Direction'
```

The default note path is `Tactical Direction`, relative to the destination project. The installer does not create notes or directories. It only adds or updates its marked instructions block, preserves other text, and follows an `AGENTS.md` symlink only when its target is inside the project. Run it in the owning vault project for external symlinks.

`--check` reports whether the managed block matches, without writing. Repeating installation is idempotent. To uninstall, remove the block between `BEGIN tactical-direction-context` and `END tactical-direction-context` from your project instructions; existing notes remain.

For a portable local package, run `npm pack` in this directory, then use its `.tgz` path with `npx --package /path/to/package.tgz auto-note-taker ...`. No npm registry release has been published. GitHub installation works without an npm registry release.
