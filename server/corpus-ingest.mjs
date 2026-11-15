/**
 * Turn a real repo or a real markdown file into verifiable evidence items.
 *
 * The rule this whole file is built around: NEVER INFER, NEVER EMBELLISH.
 * A dependency in package.json is a fact about the repo. A README sentence
 * saying "handles 10k requests/sec" is a *claim made by a document*, recorded
 * verbatim with its file and line so the candidate can decide whether to stand
 * behind it. If nothing on disk states a number, no number is produced here.
 *
 * Everything is read-only with respect to the scanned tree: no writes, and the
 * only subprocesses are `git log` / `git shortlog` reads.
 */
import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, extname, relative, basename, resolve, sep } from "node:path";
import { makeEvidence, sourceName } from "./corpus-store.mjs";

// Bounds. A scan must never wander into node_modules or read a 40MB fixture.
const MAX_FILES = 4000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_DEPTH = 12;
const MAX_COMMITS = 3000;
const GIT_TIMEOUT_MS = 20_000;

const SKIP_DIRS = new Set([
  ".git", "node_modules", "vendor", "bower_components", "dist", "build", "out",
  ".next", ".nuxt", ".svelte-kit", "target", "bin", "obj", "coverage", ".turbo",
  ".cache", "__pycache__", ".venv", "venv", "env", ".tox", ".mypy_cache",
  ".pytest_cache", ".gradle", "Pods", "DerivedData", ".terraform", ".idea",
  ".vscode", "tmp", "temp", ".expo", ".parcel-cache", "site-packages"
]);

const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "poetry.lock",
  "Pipfile.lock", "Gemfile.lock", "composer.lock", "Cargo.lock", "go.sum", ".DS_Store"
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".icns", ".pdf",
  ".zip", ".gz", ".tar", ".bz2", ".7z", ".mp4", ".mov", ".mp3", ".wav", ".woff",
  ".woff2", ".ttf", ".otf", ".eot", ".so", ".dylib", ".dll", ".exe", ".class",
  ".jar", ".pyc", ".wasm", ".db", ".sqlite", ".bin", ".pack", ".webm", ".avif"
]);

// Extension -> language label. Only what we can honestly claim from a file name.
const LANGS = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".rb": "Ruby", ".go": "Go", ".rs": "Rust", ".java": "Java",
  ".kt": "Kotlin", ".swift": "Swift", ".m": "Objective-C", ".mm": "Objective-C",
  ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++", ".hpp": "C++", ".cs": "C#",
  ".php": "PHP", ".scala": "Scala", ".ex": "Elixir", ".exs": "Elixir",
  ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell", ".sql": "SQL",
  ".html": "HTML", ".css": "CSS", ".scss": "CSS", ".sass": "CSS", ".less": "CSS",
  ".vue": "Vue", ".svelte": "Svelte", ".dart": "Dart", ".lua": "Lua", ".r": "R",
  ".tf": "Terraform", ".proto": "Protobuf", ".graphql": "GraphQL", ".gql": "GraphQL"
};

// Dependency name -> the tag a JD would use. Anything not listed still becomes
// a tag under its own lowercased name, so unknown libraries are not lost.
const DEP_TAGS = {
  react: ["react"], "react-dom": ["react"], "react-native": ["react native"],
  next: ["next.js", "react"], vue: ["vue"], svelte: ["svelte"], "@angular/core": ["angular"],
  express: ["express", "node.js"], fastify: ["fastify", "node.js"], koa: ["node.js"],
  "@nestjs/core": ["nestjs", "node.js"], django: ["django", "python"],
  flask: ["flask", "python"], fastapi: ["fastapi", "python"], rails: ["rails", "ruby"],
  pg: ["postgres", "sql"], postgres: ["postgres", "sql"], "node-postgres": ["postgres"],
  psycopg2: ["postgres", "sql"], mysql: ["mysql", "sql"], mysql2: ["mysql", "sql"],
  sqlite3: ["sqlite", "sql"], "better-sqlite3": ["sqlite", "sql"],
  mongoose: ["mongodb"], mongodb: ["mongodb"], redis: ["redis"], ioredis: ["redis"],
  prisma: ["prisma", "sql"], "@prisma/client": ["prisma", "sql"],
  typeorm: ["typeorm", "sql"], sequelize: ["sql"], knex: ["sql"],
  sqlalchemy: ["sql", "python"], "drizzle-orm": ["sql"],
  graphql: ["graphql"], "apollo-server": ["graphql"], "@apollo/client": ["graphql"],
  jest: ["testing", "jest"], vitest: ["testing", "vitest"], mocha: ["testing"],
  pytest: ["testing", "python"], playwright: ["testing", "playwright", "e2e"],
  "playwright-core": ["playwright", "e2e"], cypress: ["testing", "cypress", "e2e"],
  "@testing-library/react": ["testing", "react"],
  typescript: ["typescript"], webpack: ["webpack"], vite: ["vite"], esbuild: ["esbuild"],
  tailwindcss: ["tailwind", "css"], "styled-components": ["css"],
  "aws-sdk": ["aws"], "@aws-sdk/client-s3": ["aws", "s3"], boto3: ["aws", "python"],
  firebase: ["firebase"], "firebase-admin": ["firebase"],
  "@supabase/supabase-js": ["supabase", "postgres"],
  stripe: ["stripe", "payments"], twilio: ["twilio"],
  openai: ["openai", "llm"], "@anthropic-ai/sdk": ["anthropic", "llm"],
  langchain: ["langchain", "llm"], numpy: ["numpy", "python"],
  pandas: ["pandas", "python"], torch: ["pytorch", "ml"], tensorflow: ["tensorflow", "ml"],
  "scikit-learn": ["scikit-learn", "ml"], celery: ["celery", "python"],
  kafkajs: ["kafka"], socket: ["websockets"], "socket.io": ["websockets"],
  ws: ["websockets"], expo: ["expo", "react native"], electron: ["electron"]
};

// Commit subjects that describe shipped work, not housekeeping.
const FEATURE_PATTERNS = [
  /^feat(\(|:|\s)/i, /^perf(\(|:|\s)/i, /^refactor(\(|:|\s)/i,
  /\b(add|added|adds)\b/i, /\b(implement|implemented|implements)\b/i,
  /\b(build|built)\b/i, /\b(ship|shipped)\b/i, /\b(migrate|migrated|migration)\b/i,
  /\b(optimize|optimized|optimization)\b/i, /\bfix(ed)?\s+perf/i,
  /\b(introduce|introduced)\b/i, /\b(rewrite|rewrote)\b/i, /\b(launch|launched)\b/i
];

// Housekeeping we never want surfacing as an accomplishment.
const NOISE_PATTERNS = [
  /^merge\b/i, /^revert\b/i, /^wip\b/i, /^chore/i, /^bump\b/i, /^typo/i,
  /^update (readme|deps|dependencies|lock)/i, /^initial commit$/i, /^\.+$/, /^update$/i
];

// A sentence is only a "claim" if it carries something checkable.
const NUMBER_RE = /\b\d[\d,]*(\.\d+)?\s*(%|x\b|k\b|m\b|ms\b|s\b|gb\b|mb\b|kb\b|tb\b|req|rps|qps|users?|rows?|records?|requests?|lines?|hours?|days?|weeks?|months?|years?|customers?|clients?|tests?)/i;
const BARE_NUMBER_RE = /\b\d[\d,]{2,}(\.\d+)?\b|\b\d+(\.\d+)?%|\b\d+x\b/i;
// "scale(" is a CSS transform, not a claim about scale — require a word break.
const SCALE_WORDS = /\b(throughput|latency|uptime|scale(?![(\w])|concurrent|per second|per day|per month|requests|traffic|under load|load test\w*|p95|p99|sla)\b/i;

// Design tokens and code snippets are full of numbers that are not achievements:
// "#181820", "19px/1, weight 600", "rgba(249,123,0,.55)". A README section can
// be almost entirely these, and every one would otherwise read as a metric.
const CODEY_RE = /#[0-9a-f]{3,8}\b|rgba?\(|\b\d+(\.\d+)?(px|em|rem|deg|vh|vw|pt)\b|=>|\{\s*[a-z-]+\s*:|;\s*$|:\/\/|linear-gradient|letter-spacing|font-|margin|padding|border-radius/i;

function looksLikeCode(sentence) {
  if (CODEY_RE.test(sentence)) return true;
  // A claim needs prose around its number. "Chevron rotates 180" is a spec line.
  if ((sentence.match(/[A-Za-z]{3,}/g) ?? []).length < 5) return true;
  // Slash- or dot-separated number runs ("19/600 title", "15/18/22s") are token
  // tables. So is any sentence more digits and punctuation than words.
  if (/\d+\s*\/\s*\d+/.test(sentence)) return true;
  const numbers = sentence.match(/\d[\d,.]*/g) ?? [];
  const words = sentence.match(/[A-Za-z]{3,}/g) ?? [];
  if (numbers.length >= 4 && numbers.length > words.length / 3) return true;
  // Mostly-backticked lines are API surface or config, not a claim.
  const ticks = (sentence.match(/`/g) ?? []).length;
  if (ticks >= 4) return true;
  const backticked = [...sentence.matchAll(/`([^`]*)`/g)].reduce((n, m) => n + m[0].length, 0);
  return backticked > sentence.length * 0.4;
}

// --- small helpers --------------------------------------------------------

function globToRegExp(glob) {
  // Minimal glob: ** across segments, * within one, ? one char. Good enough for
  // include/exclude lists; we deliberately avoid a dependency for this.
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/\*\*\//g, "\x00").replace(/\*\*/g, "\x01").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\x00/g, "(?:.*/)?").replace(/\x01/g, ".*");
  return new RegExp(`^${body}$`);
}

function matchesAny(relPath, globs) {
  if (!globs?.length) return false;
  return globs.some((g) => {
    try {
      return globToRegExp(g).test(relPath);
    } catch {
      return false;
    }
  });
}

function isTextFile(name) {
  if (SKIP_FILES.has(name)) return false;
  const ext = extname(name).toLowerCase();
  if (BINARY_EXT.has(ext)) return false;
  if (/\.min\.(js|css)$/i.test(name)) return false;
  return true;
}

function safeRead(path) {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function toISODate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Walk a tree, bounded and symlink-safe.
 * Symlinks are never followed: a link pointing outside the source tree would
 * let a scan of one repo silently ingest another (or /etc).
 */
export function walkFiles(root, { include = [], exclude = [], maxFiles = MAX_FILES } = {}) {
  const files = [];
  const skipped = { dirs: 0, large: 0, binary: 0, symlinks: 0 };
  let truncated = false;
  const rootReal = resolve(root);

  const stack = [{ dir: rootReal, depth: 0 }];
  while (stack.length) {
    if (files.length >= maxFiles) {
      truncated = true;
      break;
    }
    const { dir, depth } = stack.pop();
    if (depth > MAX_DEPTH) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(rootReal, full).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        skipped.symlinks += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".") && entry.name !== ".github") {
          skipped.dirs += 1;
          continue;
        }
        if (matchesAny(rel, exclude) || matchesAny(`${rel}/`, exclude)) {
          skipped.dirs += 1;
          continue;
        }
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isTextFile(entry.name)) {
        skipped.binary += 1;
        continue;
      }
      if (matchesAny(rel, exclude)) continue;
      if (include.length && !matchesAny(rel, include)) continue;
      let size = 0;
      try {
        size = lstatSync(full).size;
      } catch {
        continue;
      }
      if (size > MAX_FILE_BYTES) {
        skipped.large += 1;
        continue;
      }
      files.push({ rel, full, size });
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
    }
  }
  return { files, skipped, truncated };
}

// --- git ------------------------------------------------------------------

function git(repoPath, args) {
  // execFileSync (not exec) so nothing the user typed can reach a shell.
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"]
  });
}

export function isGitRepo(repoPath) {
  try {
    return git(repoPath, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Git facts restricted to the candidate's own commits.
 * Attribution is by author email because a repo may have many contributors and
 * only the candidate's work is their evidence — an unattributed scan would let
 * them claim a teammate's commits.
 */
export function gitFacts(repoPath, authorEmails, since) {
  if (!isGitRepo(repoPath)) return { ok: false, reason: "not a git repository" };
  if (!authorEmails?.length) return { ok: false, reason: "no author_emails configured — git facts skipped" };

  const base = ["log", "--no-merges", `--max-count=${MAX_COMMITS}`];
  for (const email of authorEmails) base.push(`--author=${email}`);
  if (authorEmails.length > 1) base.push("--perl-regexp", "--regexp-ignore-case");
  if (since) base.push(`--since=${since}`);

  let raw;
  try {
    raw = git(repoPath, [...base, "--numstat", "--date=short", "--format=\x01%H\x02%ad\x02%s"]);
  } catch (err) {
    return { ok: false, reason: `git log failed: ${String(err?.message ?? err).split("\n")[0]}` };
  }

  const commits = [];
  const fileTouches = new Map();
  let added = 0;
  let removed = 0;

  for (const block of raw.split("\x01")) {
    if (!block.trim()) continue;
    const [header, ...statLines] = block.split("\n");
    const [hash, date, ...subjectParts] = header.split("\x02");
    const subject = subjectParts.join("\x02").trim();
    if (!hash) continue;
    const commit = { hash: hash.trim(), shortHash: hash.trim().slice(0, 8), date: date?.trim() || null, subject, files: 0 };
    for (const line of statLines) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      if (m[1] !== "-") added += Number(m[1]);
      if (m[2] !== "-") removed += Number(m[2]);
      const file = m[3].includes("=>") ? m[3].replace(/.*\{.*=>\s*(.*)\}.*/, "$1").trim() : m[3].trim();
      fileTouches.set(file, (fileTouches.get(file) ?? 0) + 1);
      commit.files += 1;
    }
    commits.push(commit);
  }

  if (commits.length === 0) {
    return { ok: false, reason: `no commits by ${authorEmails.join(", ")}${since ? ` since ${since}` : ""}` };
  }

  const dates = commits.map((c) => c.date).filter(Boolean).sort();
  // Top-level directory rollup answers "what part of the codebase did he own",
  // which a flat file list does not.
  const areas = new Map();
  for (const [file, count] of fileTouches) {
    const area = file.includes("/") ? file.split("/").slice(0, 2).join("/") : basename(file);
    areas.set(area, (areas.get(area) ?? 0) + count);
  }

  return {
    ok: true,
    commitCount: commits.length,
    truncated: commits.length >= MAX_COMMITS,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    filesTouched: fileTouches.size,
    linesAdded: added,
    linesRemoved: removed,
    topFiles: [...fileTouches.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([file, count]) => ({ file, count })),
    topAreas: [...areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([area, count]) => ({ area, count })),
    commits
  };
}

// --- manifests ------------------------------------------------------------

function tagsForDep(name) {
  const key = name.toLowerCase();
  if (DEP_TAGS[key]) return DEP_TAGS[key];
  // Unknown package: use its own name, minus scope, as the tag. Honest and
  // sometimes exactly what the JD asked for.
  return [key.replace(/^@[^/]+\//, "")];
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Real declared dependencies, per manifest file. Never guessed. */
export function parseManifests(root, files) {
  const results = [];
  const byName = new Map(files.map((f) => [f.rel, f]));

  const pushDeps = (file, deps, runtime) => {
    const clean = [...new Set(deps.map((d) => String(d).trim()).filter(Boolean))];
    if (clean.length) results.push({ file, runtime, deps: clean });
  };

  for (const [rel, file] of byName) {
    const name = basename(rel);
    // Only manifests at the repo root or one level down — a fixture's
    // package.json six levels deep is not the project's stack.
    if (rel.split("/").length > 3) continue;
    if (!["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile", "pom.xml"].includes(name) && !name.endsWith(".csproj")) continue;
    const text = safeRead(file.full);
    if (!text) continue;

    if (name === "package.json") {
      const pkg = parseJsonSafe(text);
      if (!pkg) continue;
      pushDeps(rel, [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})], "node");
    } else if (name === "requirements.txt") {
      pushDeps(rel, text.split("\n").map((l) => l.split(/[<>=!~\[;#]/)[0].trim()).filter((l) => l && !l.startsWith("-")), "python");
    } else if (name === "pyproject.toml") {
      const deps = [...text.matchAll(/^\s*["']?([A-Za-z0-9_.-]+)["']?\s*[=><~]/gm)].map((m) => m[1]);
      const inline = [...text.matchAll(/["']([A-Za-z0-9_.-]+)\s*[><=~!]=/g)].map((m) => m[1]);
      pushDeps(rel, [...deps, ...inline].filter((d) => !["python", "name", "version", "description", "requires-python", "readme"].includes(d.toLowerCase())), "python");
    } else if (name === "go.mod") {
      pushDeps(rel, [...text.matchAll(/^\s*([a-z0-9][\w.\-/]+)\s+v\d/gm)].map((m) => m[1]), "go");
    } else if (name === "Cargo.toml") {
      const depSection = text.split(/^\[dependencies\]/m)[1]?.split(/^\[/m)[0] ?? "";
      pushDeps(rel, [...depSection.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]), "rust");
    } else if (name === "Gemfile") {
      pushDeps(rel, [...text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1]), "ruby");
    } else if (name === "pom.xml") {
      pushDeps(rel, [...text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]), "java");
    } else if (name.endsWith(".csproj")) {
      pushDeps(rel, [...text.matchAll(/PackageReference\s+Include="([^"]+)"/g)].map((m) => m[1]), "dotnet");
    }
  }
  return results;
}

/** Language mix straight from file extensions — a count, not a judgment. */
export function languageCounts(files) {
  const counts = new Map();
  for (const f of files) {
    const lang = LANGS[extname(f.rel).toLowerCase()];
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([language, fileCount]) => ({ language, fileCount }));
}

/** CI, containers, deploy configs and tests — presence only, no claims. */
export function infraSignals(root, files) {
  const signals = [];
  const has = (pred) => files.filter(pred);

  const rules = [
    { tag: "ci/cd", label: "GitHub Actions CI", match: (r) => r.startsWith(".github/workflows/") },
    { tag: "ci/cd", label: "GitLab CI", match: (r) => r === ".gitlab-ci.yml" },
    { tag: "ci/cd", label: "CircleCI", match: (r) => r.startsWith(".circleci/") },
    { tag: "docker", label: "Docker", match: (r) => /^(.*\/)?Dockerfile(\..+)?$/.test(r) },
    { tag: "docker", label: "Docker Compose", match: (r) => /^(.*\/)?docker-compose.*\.ya?ml$/.test(r) },
    { tag: "kubernetes", label: "Kubernetes manifests", match: (r) => /^(k8s|kubernetes|charts)\//.test(r) },
    { tag: "terraform", label: "Terraform", match: (r) => r.endsWith(".tf") },
    { tag: "aws", label: "AWS/serverless config", match: (r) => /^(serverless\.ya?ml|template\.ya?ml|samconfig\.toml)$/.test(r) },
    { tag: "vercel", label: "Vercel config", match: (r) => r === "vercel.json" },
    { tag: "deployment", label: "Fly.io config", match: (r) => r === "fly.toml" },
    { tag: "deployment", label: "Netlify config", match: (r) => r === "netlify.toml" },
    { tag: "deployment", label: "Procfile", match: (r) => r === "Procfile" },
    { tag: "sql", label: "Database migrations", match: (r) => /(^|\/)(migrations|migrate)\//.test(r) }
  ];

  for (const rule of rules) {
    const hits = has((f) => rule.match(f.rel));
    if (hits.length) signals.push({ ...rule, count: hits.length, example: hits[0].rel });
  }

  const testFiles = has((f) => /(^|\/)(tests?|__tests__|spec|e2e)\//.test(f.rel) || /\.(test|spec)\.[a-z]+$/.test(f.rel) || /^test_.*\.py$/.test(basename(f.rel)));
  if (testFiles.length) {
    signals.push({ tag: "testing", label: "Automated tests", count: testFiles.length, example: testFiles[0].rel });
  }
  return signals;
}

// --- markdown -------------------------------------------------------------

/** Split markdown into { heading, level, body, startLine } sections. */
export function parseMarkdownSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = { heading: null, level: 0, bodyLines: [], startLine: 1 };
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      if (current.heading || current.bodyLines.length) sections.push(current);
      current = { heading: m[2].trim(), level: m[1].length, bodyLines: [], startLine: i + 1 };
    } else {
      current.bodyLines.push({ line, number: i + 1, inFence });
    }
  });
  if (current.heading || current.bodyLines.length) sections.push(current);
  return sections.map((s) => ({
    heading: s.heading,
    level: s.level,
    startLine: s.startLine,
    body: s.bodyLines.filter((l) => !l.inFence).map((l) => l.line).join("\n").trim(),
    lines: s.bodyLines.filter((l) => !l.inFence)
  }));
}

/** Pull numbers out of a sentence. Only what is literally written. */
export function extractMetrics(sentence) {
  const metrics = {};
  for (const m of sentence.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(%|x|k|m|b|ms|s|gb|mb|kb|tb|req\/s|rps|qps|\+)?/gi)) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    // Skip bare small integers with no unit: "3 steps" is not a metric.
    if (!unit && value < 100) continue;
    const key = unit ? `${value}${unit}` : String(value);
    metrics[key] = { value, unit: unit || null };
  }
  return metrics;
}

function splitSentences(text) {
  return text
    .replace(/\n{2,}/g, "\n")
    .split(/(?<=[.!?])\s+|\n[-*]\s+|\n/)
    .map((s) => s.replace(/^[-*>\s]+/, "").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 20 && s.length <= 400);
}

// Terms a JD is likely to ask for, so markdown prose can be tagged without a
// dependency list. Matched case-insensitively as whole words.
const DOC_TECH = [
  "typescript", "javascript", "python", "react", "react native", "next.js", "node",
  "node.js", "express", "fastapi", "django", "flask", "rails", "go", "rust", "java",
  "kotlin", "swift", "postgres", "postgresql", "mysql", "sqlite", "mongodb", "redis",
  "graphql", "rest", "grpc", "kafka", "docker", "kubernetes", "terraform", "aws",
  "gcp", "azure", "vercel", "firebase", "supabase", "stripe", "openai", "anthropic",
  "claude", "llm", "playwright", "cypress", "jest", "vitest", "pytest", "ci/cd",
  "websocket", "websockets", "oauth", "sso", "tailwind", "expo", "sqlalchemy", "prisma"
];

// The shape of the work, inferred from words the author actually wrote. These
// are descriptions of the commit subject, never claims about its impact.
const INTENT_TAGS = [
  [/\b(perf|performance|optimi[sz]|speed|faster|latency|cache|caching|memo)/i, ["performance", "optimization"]],
  [/\b(test|spec|coverage|e2e|regression)/i, ["testing"]],
  [/\b(migrat|backfill|schema|index)/i, ["migration", "database"]],
  [/\b(auth|login|oauth|sso|session|permission|rbac)/i, ["authentication", "security"]],
  [/\b(api|endpoint|route|webhook)/i, ["api"]],
  [/\b(ui|ux|design|layout|responsive|accessib|a11y)/i, ["frontend", "ui"]],
  // Bare "build" is how half of all commit subjects start ("Build the X"), so
  // it must not by itself imply CI/CD work.
  [/\b(deploy|pipeline|github actions|workflow)|\bci\b|\bbuild (config|pipeline|script|system)\b/i, ["ci/cd", "deployment"]],
  [/\b(refactor|cleanup|rewrite|restructur)/i, ["refactoring"]],
  [/\b(dashboard|chart|report|analytics|metric)/i, ["data visualization", "analytics"]]
];

function intentTagsIn(text) {
  return INTENT_TAGS.filter(([re]) => re.test(text)).flatMap(([, tags]) => tags);
}

function techTagsIn(text) {
  const lower = text.toLowerCase();
  return DOC_TECH.filter((t) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.+/]/g, "\\$&")}([^a-z0-9]|$)`).test(lower));
}

// --- ingestion ------------------------------------------------------------

/**
 * Scan a repo source. Returns { name, kind, path, evidence, stats, notes, error }.
 * Never throws: a missing path or a broken git binary becomes an `error` string.
 */
export function ingestRepo(entry, authorEmails = []) {
  const name = sourceName(entry);
  const path = String(entry.path);
  const result = { name, kind: "repo", path, evidence: [], notes: [], stats: {}, error: null, lastScanned: new Date().toISOString() };

  if (!existsSync(path)) {
    result.error = `path does not exist: ${path}`;
    return result;
  }
  try {
    if (!statSync(path).isDirectory()) {
      result.error = `not a directory: ${path}`;
      return result;
    }
  } catch (err) {
    result.error = String(err?.message ?? err);
    return result;
  }

  const { files, skipped, truncated } = walkFiles(path, { include: entry.include_globs ?? [], exclude: entry.exclude_globs ?? [] });
  result.stats = { filesScanned: files.length, skipped, truncated };
  if (truncated) result.notes.push(`file cap reached (${MAX_FILES}) — language counts and docs cover only the first ${MAX_FILES} files`);
  if (skipped.symlinks) result.notes.push(`${skipped.symlinks} symlink(s) skipped (never followed)`);
  if (skipped.large) result.notes.push(`${skipped.large} file(s) over 1MB skipped`);

  const add = (fields) => result.evidence.push(makeEvidence({ ...fields, sourceName: name, sourceKind: "repo" }));

  // 1. Git facts, scoped to the candidate.
  const git_ = gitFacts(path, authorEmails, entry.since);
  let range = { start: null, end: null };
  if (!git_.ok) {
    result.notes.push(git_.reason);
  } else {
    range = { start: git_.firstDate, end: git_.lastDate };
    result.stats.git = {
      commits: git_.commitCount, filesTouched: git_.filesTouched,
      linesAdded: git_.linesAdded, linesRemoved: git_.linesRemoved,
      firstDate: git_.firstDate, lastDate: git_.lastDate
    };
    if (git_.truncated) result.notes.push(`commit history truncated at ${MAX_COMMITS} commits`);

    add({
      kind: "role",
      text: `Authored ${git_.commitCount} commits in ${name} between ${git_.firstDate} and ${git_.lastDate}, touching ${git_.filesTouched} files (+${git_.linesAdded}/-${git_.linesRemoved} lines).`,
      verbatim: null,
      provenance: { file: ".git", date: git_.lastDate },
      tags: ["git"],
      metrics: {
        commits: git_.commitCount, filesTouched: git_.filesTouched,
        linesAdded: git_.linesAdded, linesRemoved: git_.linesRemoved
      },
      dateRange: range,
      confidence: "verified"
    });

    if (git_.topAreas.length) {
      add({
        kind: "scale",
        text: `Most-changed areas of ${name}: ${git_.topAreas.slice(0, 5).map((a) => `${a.area} (${a.count} changes)`).join(", ")}.`,
        verbatim: null,
        provenance: { file: ".git", date: git_.lastDate },
        tags: [...new Set(git_.topAreas.slice(0, 5).flatMap((a) => techTagsIn(a.area)))],
        metrics: Object.fromEntries(git_.topAreas.slice(0, 5).map((a) => [a.area, a.count])),
        dateRange: range,
        confidence: "verified"
      });
    }

    // Notable commits — subject kept verbatim so nothing is paraphrased into a
    // claim the commit did not make.
    const seen = new Set();
    let kept = 0;
    for (const c of git_.commits) {
      if (kept >= 60) break;
      const subject = c.subject;
      if (!subject || subject.length < 8) continue;
      if (NOISE_PATTERNS.some((re) => re.test(subject))) continue;
      if (!FEATURE_PATTERNS.some((re) => re.test(subject))) continue;
      const key = subject.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      kept += 1;
      // Tag the kind of work the subject describes, not just its technologies —
      // a JD asking for "performance" should reach a perf commit whose subject
      // never names a library.
      const tags = [...techTagsIn(subject), ...intentTagsIn(subject)];
      add({
        kind: /^perf|optimi|\bfix perf/i.test(subject) ? "feature" : "commit",
        text: `${name}: ${subject}`,
        verbatim: subject,
        provenance: { file: ".git", commit: c.shortHash, date: c.date },
        tags,
        metrics: c.files ? { filesChanged: c.files } : {},
        dateRange: { start: c.date, end: c.date },
        confidence: "verified"
      });
    }
    result.stats.notableCommits = kept;
  }

  // 2. Declared dependencies — real entries in real manifests.
  const manifests = parseManifests(path, files);
  for (const manifest of manifests) {
    const tags = [...new Set(manifest.deps.flatMap(tagsForDep))];
    add({
      kind: "stack",
      text: `${name} declares ${manifest.deps.length} ${manifest.runtime} ${manifest.deps.length === 1 ? "dependency" : "dependencies"} in ${manifest.file}, including ${manifest.deps.slice(0, 12).join(", ")}.`,
      verbatim: manifest.deps.join(", "),
      provenance: { file: manifest.file },
      tags: [manifest.runtime, ...tags],
      metrics: { dependencies: manifest.deps.length },
      dateRange: range,
      confidence: "verified"
    });
  }
  result.stats.manifests = manifests.length;

  // 3. Language mix from file extensions.
  const langs = languageCounts(files);
  if (langs.length) {
    add({
      kind: "stack",
      text: `${name} source is ${langs.slice(0, 6).map((l) => `${l.language} (${l.fileCount} files)`).join(", ")}.`,
      verbatim: null,
      provenance: { file: "." },
      tags: langs.map((l) => l.language.toLowerCase()),
      metrics: Object.fromEntries(langs.map((l) => [l.language, l.fileCount])),
      dateRange: range,
      confidence: "verified"
    });
    result.stats.languages = langs.slice(0, 8);
  }

  // 4. Infrastructure signals — presence of the file, nothing more.
  for (const signal of infraSignals(path, files)) {
    add({
      kind: "stack",
      text: `${name} uses ${signal.label} (${signal.count} file${signal.count === 1 ? "" : "s"}, e.g. ${signal.example}).`,
      verbatim: signal.example,
      provenance: { file: signal.example },
      tags: [signal.tag],
      metrics: { files: signal.count },
      dateRange: range,
      confidence: "verified"
    });
  }

  // 5. The repo's own docs. Anything they assert is a "stated" claim.
  const docFiles = files.filter((f) => /\.(md|markdown|mdx|txt)$/i.test(f.rel) && (/^(readme|architecture|design|handoff|notes)/i.test(basename(f.rel)) || /(^|\/)(docs?|notes)\//i.test(f.rel)));
  for (const f of docFiles.slice(0, 100)) {
    const text = safeRead(f.full);
    if (!text) continue;
    for (const item of docEvidence(text, { file: f.rel, sourceName: name, sourceKind: "repo", dateRange: range })) {
      result.evidence.push(item);
    }
  }
  result.stats.docFiles = docFiles.length;
  if (docFiles.length > 100) result.notes.push(`Only the first 100 of ${docFiles.length} repository documents were read.`);

  return result;
}

/**
 * Evidence from one markdown document.
 * Everything here is confidence "stated": the document says it, we quote it.
 */
export function docEvidence(text, { file, sourceName: name, sourceKind, dateRange = { start: null, end: null } }) {
  const out = [];
  const sections = parseMarkdownSections(text);

  // Internship summaries often use employer headings and describe work without
  // numbers. Keep each prose line with its actual line number, not just metrics.
  if (sourceKind === "docs") {
    for (const section of sections) for (const { line, number } of section.lines) {
      const value = line.replace(/^[-*>\s]+/, "").trim();
      if (value.length < 20 || /^\s*\|/.test(line) || looksLikeCode(value)) continue;
      // Chunk long notes instead of silently discarding everything after a cap.
      const chunks = value.match(/.{1,600}(?:\s|$)|.{1,600}/g) || [];
      for (const chunk of chunks) out.push(makeEvidence({
        sourceName: name, sourceKind, kind: "doc_claim", text: `${name}: ${chunk.trim()}`,
        verbatim: chunk.trim(), provenance: { file, line: number },
        tags: [...techTagsIn(chunk), ...intentTagsIn(chunk)], metrics: {}, dateRange, confidence: "stated"
      }));
    }
  }

  // The description: first prose paragraph under the title.
  const lead = sections.find((s) => s.body && s.body.length > 40);
  if (lead) {
    const firstPara = lead.body.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim().slice(0, 500);
    if (firstPara.length > 40) {
      out.push(makeEvidence({
        sourceName: name, sourceKind, kind: "doc_claim",
        text: `${name} — project description: ${firstPara}`,
        verbatim: firstPara,
        provenance: { file, line: lead.startLine },
        tags: techTagsIn(firstPara),
        metrics: {},
        dateRange,
        confidence: "stated"
      }));
    }
  }

  // Sections that describe what it does / how it is built / how big it is.
  const INTERESTING = /(architect|overview|what|how it works|design|stack|features?|scale|performance|usage|why|results?|impact|deploy)/i;
  for (const section of sections) {
    if (!section.heading || !section.body) continue;
    if (!INTERESTING.test(section.heading)) continue;
    const summary = section.body.replace(/\s+/g, " ").trim().slice(0, 600);
    if (summary.length < 40) continue;
    out.push(makeEvidence({
      sourceName: name, sourceKind, kind: "doc_claim",
      text: `${name} — "${section.heading}": ${summary}`,
      verbatim: summary,
      provenance: { file, line: section.startLine },
      tags: techTagsIn(`${section.heading} ${summary}`),
      metrics: {},
      dateRange,
      confidence: "stated"
    }));
  }

  // Sentences with a checkable number or a scale word, quoted with their line.
  const seen = new Set();
  for (const section of sections) {
    for (const { line, number } of section.lines ?? []) {
      // Markdown table rows are data cells, not prose claims about the work.
      if (/^\s*\|/.test(line)) continue;
      const clean = line.replace(/^[-*>\s#]+/, "").trim();
      if (clean.length < 20 || clean.length > 400) continue;
      for (const sentence of splitSentences(clean)) {
        if (looksLikeCode(sentence)) continue;
        const hasNumber = NUMBER_RE.test(sentence) || BARE_NUMBER_RE.test(sentence);
        const hasScale = SCALE_WORDS.test(sentence);
        if (!hasNumber && !hasScale) continue;
        const key = sentence.toLowerCase().slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        const metrics = hasNumber ? extractMetrics(sentence) : {};
        if (hasNumber && Object.keys(metrics).length === 0 && !hasScale) continue;
        out.push(makeEvidence({
          sourceName: name, sourceKind,
          kind: hasScale && !hasNumber ? "scale" : "metric",
          text: `${name} claims: ${sentence}`,
          verbatim: sentence,
          provenance: { file, line: number },
          tags: techTagsIn(sentence),
          metrics,
          dateRange,
          confidence: "stated"
        }));
        if (seen.size >= 80) break;
      }
      if (seen.size >= 80) break;
    }
  }

  return out;
}

/** Scan a docs source: one .md file, or a directory of them. */
export function ingestDocs(entry) {
  const name = sourceName(entry);
  const path = String(entry.path);
  const result = { name, kind: "docs", path, evidence: [], notes: [], stats: {}, error: null, lastScanned: new Date().toISOString() };

  if (!existsSync(path)) {
    result.error = `path does not exist: ${path}`;
    return result;
  }

  let docs = [];
  try {
    if (statSync(path).isDirectory()) {
      const { files, truncated, skipped } = walkFiles(path, { include: entry.include_globs ?? [], exclude: entry.exclude_globs ?? [], maxFiles: 500 });
      docs = files.filter((f) => /\.(md|markdown|mdx|txt)$/i.test(f.rel));
      if (truncated) result.notes.push("file cap reached (500) while walking docs directory");
      if (skipped.symlinks) result.notes.push(`${skipped.symlinks} symlink(s) skipped`);
    } else {
      docs = [{ rel: basename(path), full: path }];
    }
  } catch (err) {
    result.error = String(err?.message ?? err);
    return result;
  }

  if (docs.length === 0) {
    result.notes.push("no markdown files found");
    return result;
  }

  let mtimeStart = null;
  let mtimeEnd = null;
  for (const doc of docs.slice(0, 200)) {
    const text = safeRead(doc.full);
    if (!text) {
      result.notes.push(`skipped ${doc.rel} (unreadable or over 1MB)`);
      continue;
    }
    let dateRange = { start: null, end: null };
    try {
      // File mtime is the only date a plain markdown file reliably carries.
      const mtime = toISODate(statSync(doc.full).mtime);
      dateRange = { start: mtime, end: mtime };
      if (!mtimeStart || mtime < mtimeStart) mtimeStart = mtime;
      if (!mtimeEnd || mtime > mtimeEnd) mtimeEnd = mtime;
    } catch {
      /* mtime is a nicety, not a requirement */
    }
    for (const item of docEvidence(text, { file: doc.rel, sourceName: name, sourceKind: "docs", dateRange })) {
      result.evidence.push(item);
    }
  }

  result.stats = { docsScanned: Math.min(docs.length, 200), dateRange: { start: mtimeStart, end: mtimeEnd } };
  if (docs.length > 200) result.notes.push(`only the first 200 of ${docs.length} documents were read`);
  return result;
}

/** Dispatch on entry.kind. Always returns a source result, never throws. */
export function ingestSource(entry, authorEmails = []) {
  try {
    return entry.kind === "docs" ? ingestDocs(entry) : ingestRepo(entry, authorEmails);
  } catch (err) {
    return {
      name: sourceName(entry), kind: entry.kind ?? "repo", path: entry.path,
      evidence: [], notes: [], stats: {},
      error: `scan failed: ${String(err?.message ?? err).split("\n")[0]}`,
      lastScanned: new Date().toISOString()
    };
  }
}

export { MAX_FILES, MAX_FILE_BYTES, MAX_COMMITS };
