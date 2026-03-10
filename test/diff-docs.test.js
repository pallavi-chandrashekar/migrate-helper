import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { diffDocs } from "../lib/diff-docs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

async function loadFixtures() {
  const [oldDocs, newDocs] = await Promise.all([
    readFile(join(fixtures, "old-docs.md"), "utf-8"),
    readFile(join(fixtures, "new-docs.md"), "utf-8"),
  ]);
  return { oldDocs, newDocs };
}

describe("diffDocs", async () => {
  const { oldDocs, newDocs } = await loadFixtures();
  const result = diffDocs(oldDocs, newDocs);

  it("detects removed sections", () => {
    assert.ok(result.removed.length > 0, "should have at least one removed section");
    const legacyRemoved = result.removed.find((r) => r.heading === "Legacy Export");
    assert.ok(legacyRemoved, "should detect 'Legacy Export' as removed");
    assert.ok(
      legacyRemoved.apiNames.includes("exportCSV"),
      "should extract exportCSV from removed section"
    );
  });

  it("detects changed sections", () => {
    assert.ok(result.changed.length > 0, "should have at least one changed section");
    const authChanged = result.changed.find((r) => r.heading === "Authentication");
    assert.ok(authChanged, "should detect 'Authentication' as changed");
    assert.ok(
      authChanged.apiNames.includes("authenticate"),
      "should extract authenticate from changed section"
    );
  });

  it("detects signature-level parameter changes", () => {
    const authChanged = result.changed.find((r) => r.heading === "Authentication");
    assert.ok(authChanged.signatureChanges.length > 0, "should have signature changes");
    const paramChange = authChanged.signatureChanges.find(
      (s) => s.type === "params_changed" && s.name === "authenticate"
    );
    assert.ok(paramChange, "should detect authenticate param change");
    assert.deepStrictEqual(paramChange.oldParams, ["token"]);
    assert.deepStrictEqual(paramChange.newParams, ["token", "options"]);
  });

  it("detects added sections", () => {
    assert.ok(result.added.length > 0, "should have at least one added section");
    const streamingAdded = result.added.find((r) => r.heading === "Streaming API");
    assert.ok(streamingAdded, "should detect 'Streaming API' as added");
    assert.ok(
      streamingAdded.apiNames.includes("client.stream"),
      "should extract client.stream from added section"
    );
  });

  it("performs fuzzy section matching for renamed headings", () => {
    // "Client Setup" → "Client Configuration" should be a change, not remove+add
    const clientRemoved = result.removed.find((r) => r.heading === "Client Setup");
    assert.strictEqual(
      clientRemoved,
      undefined,
      "'Client Setup' should NOT be in removed — should fuzzy-match to 'Client Configuration'"
    );
    const clientChanged = result.changed.find(
      (r) => r.heading === "Client Setup" || r.headingRenamed?.from === "Client Setup"
    );
    assert.ok(clientChanged, "should detect 'Client Setup' → 'Client Configuration' as a change");
    assert.ok(clientChanged.headingRenamed, "should flag heading as renamed");
  });

  it("detects migration keywords", () => {
    const deprecated = result.keywords.find((k) => k.term === "deprecated");
    assert.ok(deprecated, "should find 'deprecated' keyword in new docs");
    const noLonger = result.keywords.find((k) => k.term === "no longer");
    assert.ok(noLonger, "should find 'no longer' keyword in new docs");
  });
});

describe("diffDocs - edge cases", () => {
  it("handles identical docs", () => {
    const doc = "## Section\n\nSome content\n";
    const result = diffDocs(doc, doc);
    assert.strictEqual(result.removed.length, 0);
    assert.strictEqual(result.changed.length, 0);
    assert.strictEqual(result.added.length, 0);
  });

  it("handles empty docs", () => {
    const result = diffDocs("", "## New Section\n\nContent\n");
    assert.strictEqual(result.added.length, 1);
    assert.strictEqual(result.removed.length, 0);
  });

  it("handles docs with no code blocks", () => {
    const oldDoc = "## Section A\n\nSome text about the old API.\n";
    const newDoc = "## Section A\n\nSome text about the new API.\n";
    const result = diffDocs(oldDoc, newDoc);
    assert.strictEqual(result.changed.length, 1);
    assert.strictEqual(result.changed[0].signatureChanges.length, 0);
  });
});
