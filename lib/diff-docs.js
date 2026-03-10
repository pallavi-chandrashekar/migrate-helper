/**
 * Split markdown into sections by headings, preserving heading level.
 */
function splitSections(markdown) {
  const sections = [];
  const lines = markdown.split("\n");
  let currentHeading = "(intro)";
  let currentLevel = 0;
  let currentLines = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      if (currentLines.length > 0 || (currentHeading !== "(intro)" && currentHeading !== "")) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: currentLines.join("\n"),
        });
      }
      currentHeading = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  const remainingContent = currentLines.join("\n");
  if (remainingContent.trim().length > 0 || (currentHeading !== "(intro)" && currentHeading !== "")) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content: remainingContent,
    });
  }
  return sections;
}

/**
 * Extract structured API signatures from code blocks.
 * Parses function definitions, class declarations, method calls with parameters.
 */
function extractApiSignatures(content) {
  const signatures = [];

  // Extract from fenced code blocks
  const codeBlocks = [...content.matchAll(/```(?:\w+)?\n([\s\S]*?)```/g)];
  for (const block of codeBlocks) {
    const code = block[1];

    // JS/TS function declarations: function name(params) / const name = (params) =>
    const funcDecls = code.matchAll(
      /(?:function\s+(\w+)\s*\(([^)]*)\)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>)/g
    );
    for (const m of funcDecls) {
      const name = m[1] || m[3];
      const params = (m[2] || m[4] || "").split(",").map((p) => p.trim()).filter(Boolean);
      signatures.push({ name, params, type: "function" });
    }

    // Class declarations
    const classDecls = code.matchAll(/class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/g);
    for (const m of classDecls) {
      signatures.push({ name: m[1], extends: m[2] || null, type: "class" });
    }

    // Method calls: obj.method(params) or obj.prop.method(params)
    const methodCalls = code.matchAll(/\b([a-zA-Z_]\w*(?:\.\w+)+)\s*\(([^)]*)\)/g);
    for (const m of methodCalls) {
      const params = m[2].split(",").map((p) => p.trim()).filter(Boolean);
      signatures.push({ name: m[1], params, type: "method_call" });
    }

    // Python function defs: def name(params):
    const pyFuncs = code.matchAll(/def\s+(\w+)\s*\(([^)]*)\)\s*(?:->.*?)?:/g);
    for (const m of pyFuncs) {
      const params = m[2].split(",").map((p) => p.trim()).filter(Boolean);
      signatures.push({ name: m[1], params, type: "function" });
    }

    // Python class declarations: class Name(Base):
    const pyClasses = code.matchAll(/class\s+(\w+)(?:\(([^)]*)\))?\s*:/g);
    for (const m of pyClasses) {
      signatures.push({ name: m[1], extends: m[2] || null, type: "class" });
    }
  }

  return signatures;
}

/**
 * Extract API-like identifiers from markdown content.
 */
function extractApiNames(content) {
  const names = new Set();

  // Inline code spans: `someFunction()`, `ClassName`, `config.option`
  const inlineCode = content.matchAll(/`([a-zA-Z_]\w*(?:\.\w+)*(?:\([^)]*\))?)`/g);
  for (const match of inlineCode) {
    const name = match[1].replace(/\(.*\)$/, "");
    if (name.length > 2) names.add(name);
  }

  // Code block contents — function/method calls and definitions
  const codeBlocks = content.matchAll(/```[\s\S]*?```/g);
  for (const block of codeBlocks) {
    const calls = block[0].matchAll(/\b([a-zA-Z_]\w*(?:\.\w+)*)\s*\(/g);
    for (const call of calls) {
      if (call[1].length > 2) names.add(call[1]);
    }
  }

  return [...names];
}

/**
 * Compute similarity between two strings (Dice coefficient on bigrams).
 */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (str) => {
    const s = str.toLowerCase();
    const set = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bigram = s.slice(i, i + 2);
      set.set(bigram, (set.get(bigram) || 0) + 1);
    }
    return set;
  };

  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  let intersection = 0;

  for (const [bigram, count] of aBigrams) {
    if (bBigrams.has(bigram)) {
      intersection += Math.min(count, bBigrams.get(bigram));
    }
  }

  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

/**
 * Compute heading similarity using both bigram and word-overlap approaches.
 * Word overlap handles cases like "Client Setup" vs "Client Configuration"
 * where they share key words but bigram similarity is low.
 */
function headingSimilarity(a, b) {
  const bigramScore = similarity(a, b);

  // Word overlap: what fraction of words are shared?
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }
  const wordScore = (2 * shared) / (wordsA.size + wordsB.size);

  return Math.max(bigramScore, wordScore);
}

/**
 * Find the best matching section in a list by heading similarity.
 * Returns the match if similarity exceeds threshold.
 */
function findFuzzyMatch(heading, sections, threshold = 0.4) {
  let bestMatch = null;
  let bestScore = 0;

  for (const section of sections) {
    const score = headingSimilarity(heading, section.heading);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = section;
    }
  }

  return bestMatch ? { section: bestMatch, score: bestScore } : null;
}

/**
 * Compare API signatures between old and new content for a changed section.
 */
function compareSignatures(oldContent, newContent) {
  const oldSigs = extractApiSignatures(oldContent);
  const newSigs = extractApiSignatures(newContent);
  const details = [];

  // Check for removed signatures
  for (const oldSig of oldSigs) {
    const match = newSigs.find((s) => s.name === oldSig.name && s.type === oldSig.type);
    if (!match) {
      // Check if it was renamed (fuzzy)
      const fuzzy = newSigs.find(
        (s) => s.type === oldSig.type && similarity(s.name, oldSig.name) > 0.6
      );
      if (fuzzy) {
        details.push({
          type: "renamed",
          old: oldSig.name,
          new: fuzzy.name,
          oldParams: oldSig.params,
          newParams: fuzzy.params,
        });
      } else {
        details.push({ type: "signature_removed", name: oldSig.name, params: oldSig.params });
      }
    } else if (oldSig.params && match.params) {
      // Same name but params changed
      const oldParams = oldSig.params.join(", ");
      const newParams = match.params.join(", ");
      if (oldParams !== newParams) {
        details.push({
          type: "params_changed",
          name: oldSig.name,
          oldParams: oldSig.params,
          newParams: match.params,
        });
      }
    }
  }

  // Check for new signatures
  for (const newSig of newSigs) {
    const match = oldSigs.find((s) => s.name === newSig.name && s.type === newSig.type);
    if (!match) {
      const wasRenamed = details.some((d) => d.type === "renamed" && d.new === newSig.name);
      if (!wasRenamed) {
        details.push({ type: "signature_added", name: newSig.name, params: newSig.params });
      }
    }
  }

  return details;
}

/**
 * Search for migration-relevant keywords in content.
 */
function findKeywords(content, heading) {
  const keywords = [
    "deprecated", "removed", "breaking", "renamed", "replaced by",
    "no longer", "migration", "upgrade", "incompatible",
  ];
  const results = [];
  const lower = content.toLowerCase();

  for (const term of keywords) {
    const idx = lower.indexOf(term);
    if (idx !== -1) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(content.length, idx + term.length + 60);
      results.push({
        term,
        context: content.slice(start, end).replace(/\n/g, " ").trim(),
        heading,
      });
    }
  }
  return results;
}

/**
 * Compare old and new markdown docs, extract changes.
 * Uses structured signature extraction and fuzzy section matching.
 */
export function diffDocs(oldMarkdown, newMarkdown) {
  const oldSections = splitSections(oldMarkdown);
  const newSections = splitSections(newMarkdown);

  const removed = [];
  const changed = [];
  const added = [];
  const keywords = [];
  const matchedNewHeadings = new Set();

  // Compare old sections against new sections
  for (const oldSection of oldSections) {
    // Try exact heading match first
    let newSection = newSections.find((s) => s.heading === oldSection.heading);

    // If no exact match, try fuzzy matching (handles renamed sections)
    if (!newSection) {
      const unmatched = newSections.filter((s) => !matchedNewHeadings.has(s.heading));
      const fuzzyResult = findFuzzyMatch(oldSection.heading, unmatched);
      if (fuzzyResult) {
        newSection = fuzzyResult.section;
      }
    }

    if (!newSection) {
      // Section was removed entirely
      removed.push({
        heading: oldSection.heading,
        apiNames: extractApiNames(oldSection.content),
        signatures: extractApiSignatures(oldSection.content),
        oldContent: oldSection.content,
      });
    } else {
      matchedNewHeadings.add(newSection.heading);

      if (oldSection.content.trim() !== newSection.content.trim()) {
        const sigChanges = compareSignatures(oldSection.content, newSection.content);
        const headingRenamed =
          oldSection.heading !== newSection.heading
            ? { from: oldSection.heading, to: newSection.heading }
            : null;

        changed.push({
          heading: oldSection.heading,
          newHeading: newSection.heading,
          headingRenamed,
          apiNames: [
            ...new Set([
              ...extractApiNames(oldSection.content),
              ...extractApiNames(newSection.content),
            ]),
          ],
          signatureChanges: sigChanges,
          oldContent: oldSection.content,
          newContent: newSection.content,
        });
      }
    }
  }

  // Sections in new but not matched → added
  for (const newSection of newSections) {
    if (!matchedNewHeadings.has(newSection.heading)) {
      added.push({
        heading: newSection.heading,
        apiNames: extractApiNames(newSection.content),
        signatures: extractApiSignatures(newSection.content),
        newContent: newSection.content,
      });
    }
  }

  // Scan new docs for migration keywords
  for (const newSection of newSections) {
    keywords.push(...findKeywords(newSection.content, newSection.heading));
  }

  return { removed, changed, added, keywords };
}
