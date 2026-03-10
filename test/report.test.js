import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateReport } from "../lib/report.js";

const sampleData = {
  library: "mylib",
  oldVersion: "1.0",
  newVersion: "2.0",
  changes: {
    removed: [
      {
        heading: "Legacy Export",
        apiNames: ["exportCSV"],
        signatures: [{ name: "exportCSV", params: ["data"], type: "function" }],
        oldContent: "...",
      },
    ],
    changed: [
      {
        heading: "Authentication",
        newHeading: "Authentication",
        headingRenamed: null,
        apiNames: ["authenticate", "client.verify"],
        signatureChanges: [
          {
            type: "params_changed",
            name: "authenticate",
            oldParams: ["token"],
            newParams: ["token", "options"],
          },
        ],
        oldContent: "...",
        newContent: "...",
      },
    ],
    added: [
      {
        heading: "Streaming API",
        apiNames: ["client.stream"],
        signatures: [],
        newContent: "...",
      },
    ],
    keywords: [
      { term: "deprecated", context: "the old method is deprecated", heading: "Auth" },
    ],
  },
  scanResults: [
    {
      file: "src/app.js",
      line: 5,
      content: "authenticate('token')",
      apiName: "authenticate",
      changeType: "changed",
      matchType: "ast",
      identType: "call",
    },
    {
      file: "src/app.js",
      line: 10,
      content: "exportCSV(data)",
      apiName: "exportCSV",
      changeType: "removed",
      matchType: "string",
      identType: "unknown",
    },
  ],
  sources: { old: "chub", new: "github" },
  warnings: ["chub: version not found"],
};

describe("generateReport - terminal output", () => {
  // Disable colors for predictable assertions
  const originalNoColor = process.env.NO_COLOR;

  it("includes report header with library and versions", () => {
    process.env.NO_COLOR = "1";
    const report = generateReport({ ...sampleData, jsonOutput: false });
    process.env.NO_COLOR = originalNoColor || "";

    assert.ok(report.includes("Migration Report: mylib v1.0 → v2.0"));
  });

  it("shows data sources", () => {
    process.env.NO_COLOR = "1";
    const report = generateReport({ ...sampleData, jsonOutput: false });
    process.env.NO_COLOR = originalNoColor || "";

    assert.ok(report.includes("old=chub, new=github"));
  });

  it("shows breaking changes", () => {
    process.env.NO_COLOR = "1";
    const report = generateReport({ ...sampleData, jsonOutput: false });
    process.env.NO_COLOR = originalNoColor || "";

    assert.ok(report.includes("[REMOVED]"));
    assert.ok(report.includes("exportCSV"));
    assert.ok(report.includes("[CHANGED]"));
    assert.ok(report.includes("authenticate"));
  });

  it("shows signature-level changes", () => {
    process.env.NO_COLOR = "1";
    const report = generateReport({ ...sampleData, jsonOutput: false });
    process.env.NO_COLOR = originalNoColor || "";

    assert.ok(report.includes("PARAMS:"));
    assert.ok(report.includes("token, options"));
  });

  it("shows new APIs", () => {
    process.env.NO_COLOR = "1";
    const report = generateReport({ ...sampleData, jsonOutput: false });
    process.env.NO_COLOR = originalNoColor || "";

    assert.ok(report.includes("[ADDED]"));
    assert.ok(report.includes("client.stream"));
  });

  it("separates AST matches from string matches", () => {
    process.env.NO_COLOR = "1";
    const report = generateReport({ ...sampleData, jsonOutput: false });
    process.env.NO_COLOR = originalNoColor || "";

    assert.ok(report.includes("(call)"));
    assert.ok(report.includes("string match"));
  });

  it("shows summary counts", () => {
    process.env.NO_COLOR = "1";
    const report = generateReport({ ...sampleData, jsonOutput: false });
    process.env.NO_COLOR = originalNoColor || "";

    assert.ok(report.includes("2 breaking change(s) detected"));
    assert.ok(report.includes("1 signature-level change(s) identified"));
    assert.ok(report.includes("1 new API(s) available"));
    assert.ok(report.includes("1 AST-verified match(es)"));
  });

  it("shows warnings from fallback", () => {
    process.env.NO_COLOR = "1";
    const report = generateReport({ ...sampleData, jsonOutput: false });
    process.env.NO_COLOR = originalNoColor || "";

    assert.ok(report.includes("chub: version not found"));
  });
});

describe("generateReport - JSON output", () => {
  it("returns valid JSON", () => {
    const report = generateReport({ ...sampleData, jsonOutput: true });
    const parsed = JSON.parse(report);
    assert.strictEqual(parsed.library, "mylib");
    assert.strictEqual(parsed.oldVersion, "1.0");
    assert.strictEqual(parsed.newVersion, "2.0");
  });

  it("includes all data in JSON", () => {
    const report = generateReport({ ...sampleData, jsonOutput: true });
    const parsed = JSON.parse(report);
    assert.strictEqual(parsed.changes.removed.length, 1);
    assert.strictEqual(parsed.changes.changed.length, 1);
    assert.strictEqual(parsed.changes.added.length, 1);
    assert.strictEqual(parsed.scanResults.length, 2);
    assert.strictEqual(parsed.sources.old, "chub");
    assert.strictEqual(parsed.sources.new, "github");
  });
});

describe("generateReport - edge cases", () => {
  it("handles empty changes gracefully", () => {
    process.env.NO_COLOR = "1";
    const report = generateReport({
      library: "mylib",
      oldVersion: "1.0",
      newVersion: "1.1",
      changes: { removed: [], changed: [], added: [], keywords: [] },
      scanResults: [],
      sources: { old: "chub", new: "chub" },
      warnings: [],
      jsonOutput: false,
    });
    process.env.NO_COLOR = "";

    assert.ok(report.includes("No breaking changes detected"));
    assert.ok(report.includes("No affected files found"));
  });

  it("handles null scanResults", () => {
    process.env.NO_COLOR = "1";
    const report = generateReport({
      library: "mylib",
      oldVersion: "1.0",
      newVersion: "1.1",
      changes: { removed: [], changed: [], added: [], keywords: [] },
      scanResults: null,
      sources: null,
      warnings: null,
      jsonOutput: false,
    });
    process.env.NO_COLOR = "";

    assert.ok(report.includes("Migration Report"));
  });
});
