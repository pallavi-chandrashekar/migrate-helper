import { execFile } from "node:child_process";
import { get as httpsGet } from "node:https";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Fetch docs for a specific library version via chub.
 */
export function fetchDocs(library, version, lang = "js") {
  return new Promise((resolve, reject) => {
    const args = ["get", `${library}/api`];
    if (version) args.push("--version", version);
    if (lang) args.push("--lang", lang);

    execFile("chub", args, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === "ENOENT") {
          reject(
            new Error(
              "chub is not installed. Run: npm install -g @aisuite/chub"
            )
          );
          return;
        }
        reject(new Error(`chub failed for ${library}@${version}: ${stderr || err.message}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error(`No docs returned for ${library}@${version}. Version may not exist in the registry.`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Make an HTTPS GET request and return the response body.
 */
function httpsRequest(url) {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { "User-Agent": "migrate-helper/0.1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsRequest(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Fallback: Fetch changelog/release notes from npm registry.
 */
async function fetchFromNpm(library, version) {
  try {
    const data = JSON.parse(await httpsRequest(`https://registry.npmjs.org/${library}`));
    const versionData = data.versions?.[version];
    if (!versionData) {
      // Try to find closest matching version
      const versions = Object.keys(data.versions || {});
      const match = versions.find((v) => v.startsWith(version));
      if (match) {
        return buildNpmDoc(data, match);
      }
      return null;
    }
    return buildNpmDoc(data, version);
  } catch {
    return null;
  }
}

function buildNpmDoc(data, version) {
  const versionData = data.versions[version];
  const lines = [];
  lines.push(`# ${data.name} v${version}`);
  lines.push("");
  if (data.description) lines.push(data.description);
  lines.push("");
  if (versionData.main) lines.push(`## Main entry: \`${versionData.main}\``);
  if (versionData.types) lines.push(`## Types: \`${versionData.types}\``);
  lines.push("");

  // Include dependency changes as signal
  if (versionData.dependencies) {
    lines.push("## Dependencies");
    for (const [dep, ver] of Object.entries(versionData.dependencies)) {
      lines.push(`- \`${dep}\`: ${ver}`);
    }
    lines.push("");
  }

  // Include exports if available
  if (versionData.exports) {
    lines.push("## Exports");
    lines.push("```json");
    lines.push(JSON.stringify(versionData.exports, null, 2));
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Fallback: Fetch GitHub release notes for a version.
 */
async function fetchFromGithub(library, version) {
  try {
    // Try common GitHub repo patterns
    const npmData = JSON.parse(await httpsRequest(`https://registry.npmjs.org/${library}`));
    let repoUrl = npmData.repository?.url || "";
    const ghMatch = repoUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (!ghMatch) return null;

    const repo = ghMatch[1];
    const tagsToTry = [`v${version}`, version, `${library}@${version}`];

    for (const tag of tagsToTry) {
      try {
        const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
        const release = JSON.parse(await httpsRequest(apiUrl));
        if (release.body) {
          return `# ${library} ${tag} Release Notes\n\n${release.body}`;
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback: Look for local CHANGELOG.md in project directory.
 */
async function fetchFromLocalChangelog(projectDir) {
  const names = ["CHANGELOG.md", "changelog.md", "CHANGES.md", "HISTORY.md"];
  for (const name of names) {
    try {
      const content = await readFile(join(projectDir, name), "utf-8");
      if (content.trim()) return content;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Fetch docs with fallback chain: chub → npm registry → GitHub releases → local changelog.
 */
async function fetchWithFallback(library, version, lang, projectDir) {
  // Try chub first
  try {
    return { source: "chub", content: await fetchDocs(library, version, lang) };
  } catch (chubError) {
    const warnings = [`chub: ${chubError.message}`];

    // Try npm registry
    console.log(`  chub unavailable for ${library}@${version}, trying npm registry...`);
    const npmDoc = await fetchFromNpm(library, version);
    if (npmDoc) {
      return { source: "npm", content: npmDoc, warnings };
    }

    // Try GitHub releases
    console.log(`  npm registry: no match, trying GitHub releases...`);
    const ghDoc = await fetchFromGithub(library, version);
    if (ghDoc) {
      return { source: "github", content: ghDoc, warnings };
    }

    // Try local changelog
    if (projectDir) {
      console.log(`  GitHub: no match, checking local changelog...`);
      const localDoc = await fetchFromLocalChangelog(projectDir);
      if (localDoc) {
        return { source: "local_changelog", content: localDoc, warnings };
      }
    }

    // Nothing found
    throw new Error(
      `Could not find documentation for ${library}@${version} from any source.\n` +
      `Tried: chub, npm registry, GitHub releases${projectDir ? ", local changelog" : ""}.\n` +
      `Original chub error: ${chubError.message}`
    );
  }
}

/**
 * Fetch docs for both versions in parallel, with fallback sources.
 */
export async function fetchBothVersions(library, oldVersion, newVersion, lang, projectDir) {
  const [oldResult, newResult] = await Promise.all([
    fetchWithFallback(library, oldVersion, lang, projectDir),
    fetchWithFallback(library, newVersion, lang, projectDir),
  ]);

  return {
    oldDocs: oldResult.content,
    newDocs: newResult.content,
    sources: {
      old: oldResult.source,
      new: newResult.source,
    },
    warnings: [...(oldResult.warnings || []), ...(newResult.warnings || [])],
  };
}
