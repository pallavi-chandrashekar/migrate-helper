import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scanProject } from "../lib/scan-project.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleProject = join(__dirname, "fixtures", "sample-project");

const testApis = [
  { apiName: "authenticate", changeType: "changed" },
  { apiName: "MyClient", changeType: "removed" },
  { apiName: "client.connect", changeType: "removed" },
  { apiName: "fetchData", changeType: "changed" },
  { apiName: "exportCSV", changeType: "removed" },
];

describe("scanProject - JavaScript AST", () => {
  it("finds all affected API usages via AST", async () => {
    const results = await scanProject(sampleProject, testApis, "js");
    assert.ok(results.length > 0, "should find at least one match");

    const astMatches = results.filter((r) => r.matchType === "ast");
    assert.ok(astMatches.length > 0, "should have AST-verified matches");
  });

  it("detects imports", async () => {
    const results = await scanProject(sampleProject, testApis, "js");
    const importMatch = results.find(
      (r) => r.apiName === "authenticate" && r.identType === "import"
    );
    assert.ok(importMatch, "should detect authenticate import");
    assert.strictEqual(importMatch.line, 1);
  });

  it("detects constructor usage (new)", async () => {
    const results = await scanProject(sampleProject, testApis, "js");
    const newMatch = results.find(
      (r) => r.apiName === "MyClient" && r.identType === "new"
    );
    assert.ok(newMatch, "should detect new MyClient()");
  });

  it("detects method calls", async () => {
    const results = await scanProject(sampleProject, testApis, "js");
    const methodMatch = results.find(
      (r) => r.apiName === "client.connect" && r.identType === "method_call"
    );
    assert.ok(methodMatch, "should detect client.connect()");
  });

  it("detects function calls", async () => {
    const results = await scanProject(sampleProject, testApis, "js");
    const callMatch = results.find(
      (r) => r.apiName === "exportCSV" && r.identType === "call"
    );
    assert.ok(callMatch, "should detect exportCSV()");
  });

  it("deduplicates results for same file:line:api", async () => {
    const results = await scanProject(sampleProject, testApis, "js");
    const keys = results.map((r) => `${r.file}:${r.line}:${r.apiName}`);
    const unique = new Set(keys);
    assert.strictEqual(keys.length, unique.size, "should have no duplicate entries");
  });
});

describe("scanProject - Python AST", () => {
  it("finds affected API usages in Python files", async () => {
    const results = await scanProject(sampleProject, testApis, "py");
    assert.ok(results.length > 0, "should find matches in Python files");
  });

  it("detects Python function calls", async () => {
    const results = await scanProject(sampleProject, testApis, "py");
    const authCall = results.find(
      (r) => r.apiName === "authenticate" && r.file.endsWith(".py")
    );
    assert.ok(authCall, "should detect authenticate() in Python");
  });
});

describe("scanProject - edge cases", () => {
  it("returns empty array for nonexistent directory", async () => {
    const results = await scanProject("/nonexistent/path", testApis, "js");
    assert.deepStrictEqual(results, []);
  });

  it("returns empty array for empty API list", async () => {
    const results = await scanProject(sampleProject, [], "js");
    assert.deepStrictEqual(results, []);
  });
});
