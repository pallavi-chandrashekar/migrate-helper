import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { execFile } from "node:child_process";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__",
  ".next", ".nuxt", "coverage", ".cache", "vendor",
]);

const LANG_EXTENSIONS = {
  js: new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]),
  py: new Set([".py"]),
};

/**
 * Recursively get all source files in a directory.
 */
async function getFiles(dir, extensions) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        results.push(...(await getFiles(fullPath, extensions)));
      }
    } else if (extensions.has(extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Strip TypeScript-specific syntax so acorn can parse the file as JS.
 * This is a lightweight approach — removes type annotations, interfaces,
 * enums, and other TS-only constructs.
 */
function stripTypescript(code) {
  return code
    // Remove type imports: import type { Foo } from 'bar'
    .replace(/import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]*['"];?/g, "")
    // Remove type-only exports
    .replace(/export\s+type\s+\{[^}]*\};?/g, "")
    // Remove interface declarations
    .replace(/interface\s+\w+(?:<[^>]*>)?\s*(?:extends\s+[^{]*)?\{[^}]*\}/g, "")
    // Remove type alias declarations
    .replace(/type\s+\w+(?:<[^>]*>)?\s*=\s*[^;]+;/g, "")
    // Remove enum declarations
    .replace(/(?:const\s+)?enum\s+\w+\s*\{[^}]*\}/g, "")
    // Remove type annotations from parameters: (param: Type)
    .replace(/:\s*(?:readonly\s+)?[\w<>\[\]|&\s.]+(?=[,)\]=}])/g, "")
    // Remove return type annotations
    .replace(/\)\s*:\s*(?:readonly\s+)?[\w<>\[\]|&\s.]+(?=\s*[{=>])/g, ")")
    // Remove 'as Type' assertions
    .replace(/\s+as\s+[\w<>\[\]|&.]+/g, "")
    // Remove angle bracket type assertions: <Type>expr
    .replace(/<[\w<>\[\]|&\s.]+>(?=\w)/g, "")
    // Remove non-null assertions
    .replace(/!(?=\.|\[)/g, "")
    // Remove 'declare' statements
    .replace(/declare\s+(?:const|let|var|function|class|module|namespace|enum|type|interface)\s+[^;{]+[;{][^}]*}?/g, "")
    // Remove generic type parameters from function/class declarations
    .replace(/<[\w\s,=extends]+>(?=\s*\()/g, "");
}

/**
 * Parse a JS/TS file with acorn and extract all identifiers that are
 * function calls, method calls, imports, or class references.
 */
function parseJsFile(code, filePath) {
  const identifiers = [];
  const isTs = /\.tsx?$/.test(filePath);
  let sourceCode = code;

  if (isTs) {
    sourceCode = stripTypescript(code);
  }

  // Remove JSX to avoid parse errors
  sourceCode = sourceCode.replace(/<\w[^>]*\/>/g, "null").replace(/<\w[^>]*>[\s\S]*?<\/\w+>/g, "null");

  let ast;
  try {
    ast = acorn.parse(sourceCode, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      allowHashBang: true,
    });
  } catch {
    // If acorn fails, return empty — fallback to string matching
    return null;
  }

  // Walk the AST to find relevant nodes
  walk.simple(ast, {
    CallExpression(node) {
      // Direct call: someFunction(...)
      if (node.callee.type === "Identifier") {
        identifiers.push({
          name: node.callee.name,
          type: "call",
          start: node.start,
          end: node.end,
        });
      }
      // Method call: obj.method(...) or obj.prop.method(...)
      if (node.callee.type === "MemberExpression") {
        const chain = resolveMemberExpression(node.callee);
        if (chain) {
          identifiers.push({
            name: chain,
            type: "method_call",
            start: node.start,
            end: node.end,
          });
        }
      }
    },
    ImportDeclaration(node) {
      for (const specifier of node.specifiers) {
        identifiers.push({
          name: specifier.local.name,
          type: "import",
          source: node.source.value,
          start: node.start,
          end: node.end,
        });
      }
    },
    NewExpression(node) {
      if (node.callee.type === "Identifier") {
        identifiers.push({
          name: node.callee.name,
          type: "new",
          start: node.start,
          end: node.end,
        });
      }
    },
  });

  return identifiers;
}

/**
 * Resolve a MemberExpression to a dotted string like "obj.prop.method".
 */
function resolveMemberExpression(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    const obj = resolveMemberExpression(node.object);
    if (obj && node.property.type === "Identifier") {
      return `${obj}.${node.property.name}`;
    }
  }
  return null;
}

/**
 * Parse a Python file using python3's ast module to extract identifiers.
 */
function parsePythonFile(filePath) {
  return new Promise((resolve) => {
    const script = `
import ast, json, sys

results = []
try:
    with open(sys.argv[1], 'r') as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                results.append({"name": node.func.id, "type": "call", "line": node.lineno})
            elif isinstance(node.func, ast.Attribute):
                parts = []
                n = node.func
                while isinstance(n, ast.Attribute):
                    parts.insert(0, n.attr)
                    n = n.value
                if isinstance(n, ast.Name):
                    parts.insert(0, n.id)
                results.append({"name": ".".join(parts), "type": "method_call", "line": node.lineno})
        elif isinstance(node, ast.Import):
            for alias in node.names:
                results.append({"name": alias.asname or alias.name, "type": "import", "line": node.lineno})
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                results.append({"name": alias.asname or alias.name, "type": "import", "source": node.module, "line": node.lineno})
    print(json.dumps(results))
except Exception:
    print("[]")
`;
    execFile("python3", ["-c", script, filePath], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Find the line number for a character offset in source code.
 */
function offsetToLine(code, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code[i] === "\n") line++;
  }
  return line;
}

/**
 * Scan project files for usage of affected API names using AST parsing
 * with string-matching fallback.
 */
export async function scanProject(projectDir, apis, lang = "js") {
  const extensions = LANG_EXTENSIONS[lang] || LANG_EXTENSIONS.js;
  const files = await getFiles(projectDir, extensions);
  const results = [];

  for (const filePath of files) {
    let content;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    // Try AST parsing first
    let identifiers = null;
    if (lang === "py") {
      identifiers = await parsePythonFile(filePath);
    } else {
      identifiers = parseJsFile(content, filePath);
    }

    if (identifiers) {
      // AST-based matching: much more precise
      for (const ident of identifiers) {
        for (const { apiName, changeType } of apis) {
          const baseName = apiName.includes(".") ? apiName.split(".").pop() : apiName;
          // Match full name or base name
          if (ident.name === apiName || ident.name === baseName || ident.name.endsWith(`.${baseName}`)) {
            const line = ident.line || offsetToLine(content, ident.start);
            const lineContent = content.split("\n")[line - 1] || "";
            results.push({
              file: filePath,
              line,
              content: lineContent.trim(),
              apiName,
              changeType,
              matchType: "ast",
              identType: ident.type,
            });
          }
        }
      }
    } else {
      // Fallback: string-based matching
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const { apiName, changeType } of apis) {
          const baseName = apiName.includes(".") ? apiName.split(".").pop() : apiName;
          if (lines[i].includes(baseName)) {
            results.push({
              file: filePath,
              line: i + 1,
              content: lines[i].trim(),
              apiName,
              changeType,
              matchType: "string",
              identType: "unknown",
            });
          }
        }
      }
    }
  }

  // Deduplicate: same file + line + apiName
  const seen = new Set();
  return results.filter((r) => {
    const key = `${r.file}:${r.line}:${r.apiName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
