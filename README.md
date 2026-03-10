# migrate-helper

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)](https://nodejs.org)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-blue.svg)](https://conventionalcommits.org)

> A CLI tool that detects breaking API changes between library versions and pinpoints affected code in your project — powered by [context-hub](https://github.com/andrewyng/context-hub).

---

## Table of Contents

- [Problem Statement](#problem-statement)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Installation](#installation)
- [Usage](#usage)
- [Sample Output](#sample-output)
- [How It Works](#how-it-works)
- [Performance and Limits](#performance-and-limits)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Dependencies](#dependencies)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Problem Statement

Library upgrades are one of the highest-friction tasks in software engineering. Engineers face:

- **No single source of truth** — breaking changes are scattered across changelogs, release notes, and migration guides
- **Manual code auditing** — grep-based searches for affected API usage produce false positives and miss method calls, imports, and constructors
- **Wasted time** — senior engineers spend hours reading diffs that a tool could summarize in seconds

**migrate-helper** solves this by automating the three hardest parts of a migration: finding what changed, finding where your code is affected, and telling you exactly what to fix.

---

## Quick Start

```bash
# Install
git clone https://github.com/pallavi-chandrashekar/migrate-helper.git
cd migrate-helper && npm install && npm link

# Run
migrate-helper openai --from 3.0 --to 4.0 --dir ./your-project
```

That's it. You'll get a full migration report in your terminal.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       migrate-helper                        │
├─────────────┬─────────────┬───────────────┬─────────────────┤
│  fetch-docs │  diff-docs  │ scan-project  │     report      │
│             │             │               │                 │
│  chub ─────►│  Section    │  JS/TS: acorn │  Terminal (ANSI)│
│  npm ──────►│  splitting  │  Python: ast  │  JSON output    │
│  GitHub ───►│  Fuzzy match│  Fallback:    │                 │
│  Local ────►│  Signature  │  string match │                 │
│  changelog  │  extraction │               │                 │
└─────────────┴─────────────┴───────────────┴─────────────────┘

Flow:
  1. Fetch docs (old ver) ──┐
                            ├──► Diff ──► Extract affected APIs ──► Scan project ──► Report
  2. Fetch docs (new ver) ──┘
```

**Data source fallback chain:**

```
chub (curated docs)
  └─ fail ──► npm registry (package metadata, exports)
                └─ fail ──► GitHub releases (release notes)
                              └─ fail ──► Local CHANGELOG.md
                                            └─ fail ──► Error with clear message
```

---

## Installation

### Prerequisites

| Requirement | Required | Notes |
|-------------|----------|-------|
| Node.js >= 18.17 | Yes | Uses `parseArgs`, `recursive readdir` |
| [context-hub](https://github.com/andrewyng/context-hub) CLI | No | Recommended. Fallback sources available if missing |
| Python 3 | No | Only needed for `--lang py` AST parsing |

### Install from source

```bash
git clone https://github.com/pallavi-chandrashekar/migrate-helper.git
cd migrate-helper
npm install
npm link   # Makes 'migrate-helper' available globally
```

### Run without installing

```bash
node bin/migrate-helper.js <library> --from <old> --to <new>
```

---

## Usage

```bash
migrate-helper <library> --from <oldVersion> --to <newVersion> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--from <version>` | Old/current library version | *(required)* |
| `--to <version>` | New/target library version | *(required)* |
| `--dir <path>` | Project directory to scan | Current directory |
| `--lang <js\|py>` | Language variant for docs and scanning | `js` |
| `--json` | Output as JSON (for CI/CD pipelines) | `false` |
| `--help` | Show help message | |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success — report generated |
| `1` | Error — missing args, docs not found, or scan failure |

### Examples

```bash
# Basic migration check
migrate-helper openai --from 3.0 --to 4.0

# Scan a specific project directory
migrate-helper stripe --from 2.0 --to 3.0 --dir ./my-app

# Python project
migrate-helper openai --from 0.28 --to 1.0 --lang py

# JSON output for CI pipelines
migrate-helper openai --from 3.0 --to 4.0 --json | jq '.changes.removed'

# Works without chub installed (auto-fallback to npm/GitHub)
migrate-helper express --from 4.0.0 --to 5.0.0
```

---

## Sample Output

```
──────────────────────────────────────────────────────────
  Migration Report: openai v3.0 → v4.0
──────────────────────────────────────────────────────────

  Data sources: old=chub, new=chub

  BREAKING CHANGES

  [REMOVED] ChatCompletion.create
           Section: "Legacy Completions"
           method_call: ChatCompletion.create(model, messages)
  [CHANGED] OpenAI, apiKey
           Section: "Client Setup"
           PARAMS: createClient(key, secret) → (apiKey, apiSecret)
           RENAMED: OldClient → NewClient
  [KEYWORD] "deprecated" found in "Migration Notes"
           ...the v3 ChatCompletion.create method is deprecated...

  NEW APIs

  [ADDED] client.chat.completions.create
         Section: "Chat Completions"
         method_call: client.chat.completions.create(model, messages)

  AFFECTED FILES IN YOUR PROJECT

  src/api/chat.js:1   [CHANGED] OpenAI (import)
    import OpenAI from 'openai';
  src/api/chat.js:5   [REMOVED] ChatCompletion.create (method_call)
    const response = await ChatCompletion.create(params);
  src/api/chat.js:12  [CHANGED] createClient (call)
    const client = createClient({ key: 'abc', secret: 'xyz' });

  SUMMARY

  2 breaking change(s) detected
  3 signature-level change(s) identified
  1 new API(s) available
  1 file(s) affected (3 occurrence(s))
  3 AST-verified match(es), 0 string match(es)

  NEXT STEPS

  1. Review changed APIs and update call signatures
  2. Replace removed APIs with new equivalents
  3. Run: chub get openai/api --version 4.0
     for the full updated documentation
```

---

## How It Works

### 1. Structured documentation diffing

The tool goes beyond simple text comparison:

- **Section-level splitting** — Markdown is split by headings (`#` through `####`), each section compared independently
- **Fuzzy section matching** — Renamed sections are detected using Dice coefficient similarity (threshold: 0.6), so `"Client Setup"` matches `"Client Configuration"`
- **API signature extraction** — Function declarations, class definitions, and method calls are parsed from code blocks with their parameter lists, enabling detection of:
  - Parameter additions/removals
  - Function/method renames
  - Signature changes
- **Keyword scanning** — Searches for migration-relevant terms: `deprecated`, `removed`, `breaking`, `renamed`, `replaced by`, `no longer`, `migration`, `upgrade`, `incompatible`

### 2. AST-based project scanning

Instead of string matching (which produces false positives), the tool parses source code into an Abstract Syntax Tree:

| Language | Parser | Identifies |
|----------|--------|------------|
| JavaScript/TypeScript | [acorn](https://github.com/acornjs/acorn) with TS stripping | Function calls, method calls, imports, constructors |
| Python | `python3 ast` module (shell) | Function calls, method calls, imports |

**Fallback behavior:** If AST parsing fails (syntax errors, unsupported syntax), the tool falls back to string matching. The report labels each match as `(ast)` or `(string match)` so you know confidence level.

### 3. Multi-source documentation fallback

| Priority | Source | What it provides |
|----------|--------|-----------------|
| 1 | chub (context-hub) | Curated, structured API docs |
| 2 | npm registry | Package metadata, exports, dependencies |
| 3 | GitHub releases | Release notes, auto-detected from npm metadata |
| 4 | Local changelog | `CHANGELOG.md`, `CHANGES.md`, or `HISTORY.md` in project dir |

The report header shows which source was used: `Data sources: old=chub, new=github`.

---

## Performance and Limits

| Dimension | Expectation |
|-----------|-------------|
| **Doc fetching** | Both versions fetched in parallel. 30s timeout per request. |
| **Diffing** | Near-instant for typical API docs (< 1MB markdown). |
| **Project scanning** | Handles hundreds of source files in under a second. Skips `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.next`, `.nuxt`, `coverage`, `.cache`, `vendor`. |
| **Memory** | Files read sequentially, not buffered in bulk. Safe for large projects. |

### Known limits

- **Fuzzy matching threshold (0.6)** may miss sections with very different headings or match unrelated sections with similar names. Tune based on results.
- **TypeScript stripping is regex-based**, not a full TS parser. Complex generic types, decorators, or exotic TS patterns may cause acorn to fall back to string matching.
- **Python AST requires `python3` on PATH.** If unavailable, Python files fall back to string matching silently.
- **npm/GitHub fallback provides less detail** than chub. Package metadata doesn't contain API signatures — diffing will rely on structural changes in exports and dependencies.

---

## Security

- **No credentials stored or transmitted.** The tool reads local files and makes unauthenticated HTTPS requests to public APIs (registry.npmjs.org, api.github.com).
- **No code execution.** Project files are parsed (read-only AST), never evaluated or executed.
- **No data exfiltration.** The `--json` flag outputs to stdout only. No telemetry, no analytics, no network calls beyond doc fetching.
- **Dependency surface is minimal:** 2 runtime dependencies (`acorn`, `acorn-walk`), both widely audited and maintained by the acorn team.

---

## Troubleshooting

### `chub is not installed`

```
Error: chub is not installed. Run: npm install -g @aisuite/chub
```

chub is optional. If you don't want to install it, the tool will automatically fall back to npm registry and GitHub releases. This message appears as a warning, not a blocker, unless all fallback sources also fail.

### `No docs returned for <library>@<version>`

The version doesn't exist in the chub registry. The tool will try fallback sources. If all fail, verify:
- The library name matches what's on npm (e.g., `openai`, not `openai-sdk`)
- The version string matches an actual published version (e.g., `4.0.0`, not `4`)

### AST parsing falls back to string matching

You'll see `(string match)` labels in the report. Common causes:
- TypeScript with complex generics or decorators
- Non-standard syntax (e.g., proposal-stage JS features)
- Files with syntax errors

This is by design — string matching is a safe fallback. Verify these matches manually.

### `python3: command not found`

Python AST parsing requires `python3` on your PATH. Install Python 3 or use `--lang js` if you don't need Python scanning.

### Empty report / no breaking changes

Possible causes:
- The two versions have identical documentation in the registry
- The library's docs don't use standard heading/code block conventions
- The fallback source (npm/GitHub) doesn't contain enough detail for meaningful diffing

Try `--json` to inspect the raw diff data.

---

## Dependencies

### Runtime

| Package | Version | Purpose | Maintainer |
|---------|---------|---------|------------|
| [acorn](https://github.com/acornjs/acorn) | ^8.16.0 | JavaScript AST parsing | acorn team |
| [acorn-walk](https://github.com/acornjs/acorn/tree/master/acorn-walk) | ^8.3.5 | AST tree traversal | acorn team |

### Dev

| Package | Purpose |
|---------|---------|
| [@commitlint/cli](https://commitlint.js.org/) | Commit message linting |
| [@commitlint/config-conventional](https://commitlint.js.org/) | Conventional commit rules |
| [husky](https://typicode.github.io/husky/) | Git hooks |

Everything else uses Node.js built-ins: `node:util`, `node:fs/promises`, `node:https`, `node:child_process`, `node:path`.

---

## Project Structure

```
migrate-helper/
  package.json
  commitlint.config.js        # Conventional commit rules
  .github/
    workflows/
      release-please.yml      # Automated versioning and releases
  .husky/
    commit-msg                 # Commit message validation hook
  bin/
    migrate-helper.js          # CLI entry point — arg parsing, orchestration
  lib/
    fetch-docs.js              # Doc fetching: chub → npm → GitHub → local fallback
    diff-docs.js               # Structured diffing: section split, fuzzy match, signature extraction
    scan-project.js            # AST scanning: acorn (JS/TS), python3 ast, string fallback
    report.js                  # Output: terminal (ANSI color) and JSON formats
```

---

## Contributing

This project uses [Conventional Commits](https://www.conventionalcommits.org/) and automated releases.

### Commit message format

Every commit must follow the conventional format — enforced by commitlint + husky:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

| Type | Description | Version bump |
|------|-------------|--------------|
| `feat` | New feature | Minor (0.1.0 → 0.2.0) |
| `fix` | Bug fix | Patch (0.1.0 → 0.1.1) |
| `feat!` | Breaking change | Major (0.1.0 → 1.0.0) |
| `docs` | Documentation only | None |
| `refactor` | Code change, no behavior change | None |
| `perf` | Performance improvement | None |
| `test` | Adding or updating tests | None |
| `build` | Build system or dependencies | None |
| `ci` | CI/CD configuration | None |
| `chore` | Maintenance tasks | None |

```bash
git commit -m "feat(scan): add Go AST parsing"     # ✓
git commit -m "fix(diff): handle empty code blocks" # ✓
git commit -m "fixed stuff"                         # ✗ rejected
```

### Release process

Releases are automated via [release-please](https://github.com/googleapis/release-please):

1. Merge commits to `main` with conventional messages
2. Release Please opens a **Release PR** — bumps version, generates changelog
3. Review and merge the Release PR when ready
4. Release Please creates a **GitHub Release** with tag and changelog

No manual version bumping, tagging, or changelog writing required.

### Development setup

```bash
git clone https://github.com/pallavi-chandrashekar/migrate-helper.git
cd migrate-helper
npm install    # Installs dependencies + sets up husky hooks
```

---

## License

MIT
