# migrate-helper

A CLI tool that helps you migrate between library versions by comparing API documentation fetched via [context-hub](https://github.com/andrewyng/context-hub), with AST-based code scanning and multi-source fallback.

## How it works

1. Fetches documentation for both the old and new library versions using `chub get`, with automatic fallback to npm registry, GitHub releases, and local changelogs
2. Diffs the docs using structured API signature extraction and fuzzy section matching to identify removed, changed, renamed, and added APIs
3. Scans your project files using AST parsing (acorn for JS/TS, python3 ast for Python) to precisely locate affected API usage
4. Outputs a migration report with file locations, signature-level change details, and suggested next steps

## Prerequisites

- Node.js >= 18.17
- [context-hub](https://github.com/andrewyng/context-hub) CLI installed globally (recommended, but not required — fallback sources are available):
  ```bash
  npm install -g @aisuite/chub
  ```
- Python 3 (optional, for Python AST parsing when using `--lang py`)

## Installation

```bash
git clone <repo-url> && cd migrate-helper
npm install
npm link
```

Or run directly without installing globally:

```bash
node bin/migrate-helper.js <library> --from <old> --to <new>
```

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
| `--lang <js\|py>` | Language variant for docs | `js` |
| `--json` | Output as JSON instead of terminal report | `false` |
| `--help` | Show help message | |

### Examples

```bash
# Compare OpenAI SDK v3 to v4, scan current project
migrate-helper openai --from 3.0 --to 4.0

# Compare Stripe SDK versions, scan a specific directory
migrate-helper stripe --from 2.0 --to 3.0 --dir ./my-app

# Get Python-specific docs
migrate-helper openai --from 0.28 --to 1.0 --lang py

# Output as JSON for piping to other tools
migrate-helper openai --from 3.0 --to 4.0 --json | jq '.changes.removed'

# Works even without chub installed (falls back to npm/GitHub)
migrate-helper express --from 4.0.0 --to 5.0.0
```

### Sample output

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

## How it works under the hood

### Structured documentation diffing

The tool goes beyond simple text comparison:

- **Section-level splitting** — Markdown is split by headings (`#` through `####`), and each section is compared independently
- **Fuzzy section matching** — Renamed sections are detected using Dice coefficient similarity on headings (threshold: 0.6), so `"Client Setup"` matches `"Client Configuration"`
- **API signature extraction** — Function declarations, class definitions, and method calls are parsed from code blocks with their parameter lists, enabling detection of:
  - Parameter additions/removals
  - Function renames
  - Signature changes
- **Keyword scanning** — Searches for migration-relevant terms (`deprecated`, `removed`, `breaking`, `renamed`, `replaced by`, `no longer`, `migration`, `upgrade`, `incompatible`)

### AST-based project scanning

Instead of simple string matching, the tool parses your source code into an Abstract Syntax Tree:

- **JavaScript/TypeScript** — Uses [acorn](https://github.com/acornjs/acorn) parser with TypeScript stripping. Identifies:
  - Function calls (`authenticate(token)`)
  - Method calls (`client.connect(opts)`)
  - Import declarations (`import { Foo } from 'bar'`)
  - Constructor usage (`new OldClient(config)`)
- **Python** — Shells out to `python3 ast` module for native parsing. Identifies the same categories of usage.
- **Fallback** — If AST parsing fails (e.g., syntax errors, exotic syntax), gracefully falls back to string matching. The report clearly labels each match as `(ast)` or `(string match)` so you know which results to verify manually.

### Multi-source documentation fallback

When `chub` doesn't have a library or version, the tool automatically tries alternative sources:

1. **chub** (context-hub registry) — primary source, curated docs
2. **npm registry** — fetches package metadata, exports, and dependency info from `registry.npmjs.org`
3. **GitHub releases** — fetches release notes via the GitHub API, auto-detecting the repo from npm metadata
4. **Local changelog** — checks for `CHANGELOG.md`, `CHANGES.md`, or `HISTORY.md` in your project directory

The report header shows which source was used for each version (e.g., `Data sources: old=chub, new=github`), and any warnings about fallback usage.

## Dependencies

| Package | Purpose |
|---------|---------|
| [acorn](https://github.com/acornjs/acorn) | JavaScript AST parsing |
| [acorn-walk](https://github.com/acornjs/acorn/tree/master/acorn-walk) | AST tree traversal |

Everything else uses Node.js built-ins (`node:util`, `node:fs`, `node:https`, `node:child_process`).

## Project structure

```
migrate-helper/
  package.json
  bin/
    migrate-helper.js     # CLI entry point and argument parsing
  lib/
    fetch-docs.js         # Doc fetching with chub → npm → GitHub → local fallback
    diff-docs.js          # Structured diffing with signature extraction and fuzzy matching
    scan-project.js       # AST-based project scanning (acorn + python3 ast)
    report.js             # Terminal and JSON report formatter
```

## License

MIT
