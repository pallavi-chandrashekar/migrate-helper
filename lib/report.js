const useColor = !process.env.NO_COLOR;

const c = {
  red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
  magenta: (s) => (useColor ? `\x1b[35m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
};

function formatSignatureChanges(sigChanges) {
  const lines = [];
  for (const change of sigChanges) {
    switch (change.type) {
      case "renamed":
        lines.push(`           ${c.magenta("RENAMED:")} ${change.old} → ${change.new}`);
        if (change.oldParams?.length || change.newParams?.length) {
          lines.push(`           ${c.dim(`params: (${(change.oldParams || []).join(", ")}) → (${(change.newParams || []).join(", ")})`)}`);
        }
        break;
      case "params_changed":
        lines.push(`           ${c.yellow("PARAMS:")} ${change.name}(${(change.oldParams || []).join(", ")}) → (${(change.newParams || []).join(", ")})`);
        break;
      case "signature_removed":
        lines.push(`           ${c.red("SIG REMOVED:")} ${change.name}(${(change.params || []).join(", ")})`);
        break;
      case "signature_added":
        lines.push(`           ${c.green("SIG ADDED:")} ${change.name}(${(change.params || []).join(", ")})`);
        break;
    }
  }
  return lines;
}

export function generateReport({ library, oldVersion, newVersion, changes, scanResults, sources, warnings, jsonOutput }) {
  if (jsonOutput) {
    return JSON.stringify({ library, oldVersion, newVersion, changes, scanResults, sources, warnings }, null, 2);
  }

  const lines = [];
  const hr = "─".repeat(60);

  lines.push("");
  lines.push(c.bold(`${hr}`));
  lines.push(c.bold(`  Migration Report: ${library} v${oldVersion} → v${newVersion}`));
  lines.push(c.bold(`${hr}`));

  // Show data sources
  if (sources) {
    lines.push("");
    lines.push(c.dim(`  Data sources: old=${sources.old}, new=${sources.new}`));
    if (warnings && warnings.length > 0) {
      for (const w of warnings) {
        lines.push(c.dim(`  ⚠ ${w}`));
      }
    }
  }
  lines.push("");

  // Breaking changes
  if (changes.removed.length > 0 || changes.changed.length > 0 || changes.keywords.length > 0) {
    lines.push(c.bold("  BREAKING CHANGES"));
    lines.push("");

    for (const item of changes.removed) {
      const apis = item.apiNames.length > 0 ? item.apiNames.join(", ") : "(section)";
      lines.push(`  ${c.red("[REMOVED]")} ${c.cyan(apis)}`);
      lines.push(`           ${c.dim(`Section: "${item.heading}"`)}`);
      // Show signature details if available
      if (item.signatures?.length > 0) {
        for (const sig of item.signatures) {
          const params = sig.params ? `(${sig.params.join(", ")})` : "";
          lines.push(`           ${c.dim(`${sig.type}: ${sig.name}${params}`)}`);
        }
      }
    }

    for (const item of changes.changed) {
      const apis = item.apiNames.length > 0 ? item.apiNames.join(", ") : "(section)";
      lines.push(`  ${c.yellow("[CHANGED]")} ${c.cyan(apis)}`);
      if (item.headingRenamed) {
        lines.push(`           ${c.magenta(`Section renamed: "${item.headingRenamed.from}" → "${item.headingRenamed.to}"`)}`);
      } else {
        lines.push(`           ${c.dim(`Section: "${item.heading}"`)}`);
      }
      // Show detailed signature changes
      if (item.signatureChanges?.length > 0) {
        lines.push(...formatSignatureChanges(item.signatureChanges));
      }
    }

    for (const kw of changes.keywords) {
      lines.push(`  ${c.red("[KEYWORD]")} "${kw.term}" found in "${kw.heading}"`);
      lines.push(`           ${c.dim(kw.context)}`);
    }
    lines.push("");
  } else {
    lines.push(c.green("  No breaking changes detected in documentation."));
    lines.push("");
  }

  // New APIs
  if (changes.added.length > 0) {
    lines.push(c.bold("  NEW APIs"));
    lines.push("");
    for (const item of changes.added) {
      const apis = item.apiNames.length > 0 ? item.apiNames.join(", ") : "(section)";
      lines.push(`  ${c.green("[ADDED]")} ${c.cyan(apis)}`);
      lines.push(`         ${c.dim(`Section: "${item.heading}"`)}`);
      if (item.signatures?.length > 0) {
        for (const sig of item.signatures) {
          const params = sig.params ? `(${sig.params.join(", ")})` : "";
          lines.push(`         ${c.dim(`${sig.type}: ${sig.name}${params}`)}`);
        }
      }
    }
    lines.push("");
  }

  // Affected files
  if (scanResults && scanResults.length > 0) {
    lines.push(c.bold("  AFFECTED FILES IN YOUR PROJECT"));
    lines.push("");

    // Group by match type for clarity
    const astMatches = scanResults.filter((r) => r.matchType === "ast");
    const stringMatches = scanResults.filter((r) => r.matchType === "string");

    for (const result of astMatches) {
      const tag =
        result.changeType === "removed"
          ? c.red("[REMOVED]")
          : c.yellow("[CHANGED]");
      const identLabel = c.dim(`(${result.identType})`);
      lines.push(`  ${result.file}:${result.line}  ${tag} ${c.cyan(result.apiName)} ${identLabel}`);
      lines.push(`    ${c.dim(result.content)}`);
    }

    if (stringMatches.length > 0 && astMatches.length > 0) {
      lines.push("");
      lines.push(c.dim("  Possible matches (string-based, verify manually):"));
    }
    for (const result of stringMatches) {
      const tag =
        result.changeType === "removed"
          ? c.red("[REMOVED]")
          : c.yellow("[CHANGED]");
      lines.push(`  ${result.file}:${result.line}  ${tag} ${c.cyan(result.apiName)} ${c.dim("(string match)")}`);
      lines.push(`    ${c.dim(result.content)}`);
    }
    lines.push("");
  } else if (scanResults) {
    lines.push(c.green("  No affected files found in your project."));
    lines.push("");
  }

  // Summary
  const breakingCount = changes.removed.length + changes.changed.length;
  const sigChangeCount = changes.changed.reduce(
    (sum, ch) => sum + (ch.signatureChanges?.length || 0), 0
  );
  const fileCount = scanResults ? new Set(scanResults.map((r) => r.file)).size : 0;
  const astCount = scanResults ? scanResults.filter((r) => r.matchType === "ast").length : 0;

  lines.push(c.bold("  SUMMARY"));
  lines.push("");
  lines.push(`  ${breakingCount} breaking change(s) detected`);
  if (sigChangeCount > 0) {
    lines.push(`  ${sigChangeCount} signature-level change(s) identified`);
  }
  lines.push(`  ${changes.added.length} new API(s) available`);
  if (scanResults) {
    lines.push(`  ${fileCount} file(s) affected (${scanResults.length} occurrence(s))`);
    if (astCount > 0) {
      lines.push(`  ${astCount} AST-verified match(es), ${scanResults.length - astCount} string match(es)`);
    }
  }
  lines.push("");

  // Next steps
  lines.push(c.bold("  NEXT STEPS"));
  lines.push("");
  lines.push(`  1. Review changed APIs and update call signatures`);
  lines.push(`  2. Replace removed APIs with new equivalents`);
  lines.push(`  3. Run: ${c.cyan(`chub get ${library}/api --version ${newVersion}`)}`);
  lines.push(`     for the full updated documentation`);
  lines.push("");

  return lines.join("\n");
}
