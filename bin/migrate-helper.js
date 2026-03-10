#!/usr/bin/env node

import { parseArgs } from "node:util";
import { fetchBothVersions } from "../lib/fetch-docs.js";
import { diffDocs } from "../lib/diff-docs.js";
import { scanProject } from "../lib/scan-project.js";
import { generateReport } from "../lib/report.js";

function printUsage() {
  console.log(`
Usage: migrate-helper <library> --from <oldVersion> --to <newVersion> [options]

Options:
  --from <version>   Old/current library version
  --to <version>     New/target library version
  --dir <path>       Project directory to scan (default: current directory)
  --lang <js|py>     Language variant (default: js)
  --json             Output as JSON
  --help             Show this help message

Examples:
  migrate-helper openai --from 3.0 --to 4.0
  migrate-helper stripe --from 2.0 --to 3.0 --lang js --dir ./my-project
  migrate-helper express --from 4.0.0 --to 5.0.0
`);
}

async function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        from: { type: "string" },
        to: { type: "string" },
        dir: { type: "string", default: process.cwd() },
        lang: { type: "string", default: "js" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
  } catch (e) {
    console.error(`Error: ${e.message}`);
    printUsage();
    process.exit(1);
  }

  if (args.values.help) {
    printUsage();
    process.exit(0);
  }

  const library = args.positionals[0];
  const { from: oldVersion, to: newVersion, dir, lang, json: jsonOutput } = args.values;

  if (!library || !oldVersion || !newVersion) {
    console.error("Error: library name, --from, and --to are required.");
    printUsage();
    process.exit(1);
  }

  try {
    // Step 1: Fetch docs for both versions (with fallback chain)
    console.log(`Fetching docs for ${library} v${oldVersion} and v${newVersion}...`);
    const { oldDocs, newDocs, sources, warnings } = await fetchBothVersions(
      library, oldVersion, newVersion, lang, dir
    );

    // Step 2: Diff the docs
    console.log("Comparing documentation...");
    const changes = diffDocs(oldDocs, newDocs);

    // Step 3: Collect API names to scan for
    const apisToScan = [
      ...changes.removed.flatMap((r) =>
        r.apiNames.map((apiName) => ({ apiName, changeType: "removed" }))
      ),
      ...changes.changed.flatMap((ch) =>
        ch.apiNames.map((apiName) => ({ apiName, changeType: "changed" }))
      ),
    ];

    // Step 4: Scan project with AST parsing
    let scanResults = null;
    if (apisToScan.length > 0) {
      console.log(`Scanning project at ${dir} for ${apisToScan.length} affected API(s)...`);
      scanResults = await scanProject(dir, apisToScan, lang);
    } else {
      console.log("No affected APIs to scan for.");
      scanResults = [];
    }

    // Step 5: Generate report
    const report = generateReport({
      library,
      oldVersion,
      newVersion,
      changes,
      scanResults,
      sources,
      warnings,
      jsonOutput,
    });

    console.log(report);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}

main();
