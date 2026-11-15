/**
 * Evidence corpus store — data/corpus.json.
 *
 * The corpus holds facts about what the candidate actually built, each one
 * traceable to the file or commit it came from. It exists so the resume tailor
 * can align a resume to a job description without inventing anything: it asks
 * for evidence matching the JD's keywords and gets back real, sourced items.
 *
 * Evidence item shape:
 *   {
 *     id,                 // stable hash of sourceName + kind + text
 *     sourceName,         // registry name of the repo or docs path it came from
 *     sourceKind,         // "repo" | "docs"
 *     kind,               // "stack" | "metric" | "commit" | "feature"
 *                         // | "doc_claim" | "scale" | "role"
 *     text,               // the fact in plain words, safe to show a human
 *     verbatim,           // exact source text, where there is one (else null)
 *     provenance: { file, line?, commit?, date? },
 *     tags: [],           // lowercase skills/keywords this evidence demonstrates
 *     metrics: {},        // only numbers actually extracted from the source
 *     dateRange: { start, end },   // ISO dates, either may be null
 *     confidence          // "verified" = computed from git/files
 *                         // "stated"   = claimed in a document
 *   }
 *
 * THE INTEGRATION POINT is queryEvidence(keywords, opts) at the bottom of this
 * file. Callers (resume tailor, tracker UI) should use it rather than reading
 * data/corpus.json directly, so the scoring stays in one place.
 *
 * Nothing in here throws on a missing or malformed corpus — a candidate who has
 * not run the scanner yet should get empty results, not a crash mid-application.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.JOB_DESK_DATA || join(ROOT, "data");
const CORPUS_PATH = join(DATA_DIR, "corpus.json");
const SOURCES_PATH = join(DATA_DIR, "corpus-sources.json");
const SOURCES_EXAMPLE_PATH = join(ROOT, "data", "seed", "corpus-sources.example.json");

export const EVIDENCE_KINDS = ["stack", "metric", "commit", "feature", "doc_claim", "scale", "role"];

function emptyCorpus() {
  return { version: 1, lastScanned: null, authorEmails: [], sources: [] };
}

/** Read data/corpus.json. Never throws — a corrupt file reads as empty. */
export function loadCorpus() {
  try {
    if (!existsSync(CORPUS_PATH)) return emptyCorpus();
    const parsed = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return emptyCorpus();
    return {
      version: parsed.version ?? 1,
      lastScanned: parsed.lastScanned ?? null,
      authorEmails: Array.isArray(parsed.authorEmails) ? parsed.authorEmails : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources : []
    };
  } catch {
    return emptyCorpus();
  }
}

/** Write data/corpus.json atomically, so a crash mid-scan cannot truncate it. */
export function saveCorpus(corpus) {
  const out = { ...emptyCorpus(), ...corpus };
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${CORPUS_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`);
  renameSync(tmp, CORPUS_PATH);
  return out;
}

/**
 * Read the source registry (data/corpus-sources.json).
 * Falls back to the example file so `--list` works before the user copies it.
 */
export function loadSources() {
  const path = existsSync(SOURCES_PATH) ? SOURCES_PATH : SOURCES_EXAMPLE_PATH;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const sources = Array.isArray(parsed?.sources) ? parsed.sources : [];
    return {
      path,
      isExample: path === SOURCES_EXAMPLE_PATH,
      authorEmails: (Array.isArray(parsed?.author_emails) ? parsed.author_emails : [])
        .filter((e) => typeof e === "string" && e.includes("@"))
        .map((e) => e.trim().toLowerCase()),
      sources: sources.filter((s) => s && (s.kind === "repo" || s.kind === "docs") && s.path)
    };
  } catch {
    return { path, isExample: path === SOURCES_EXAMPLE_PATH, authorEmails: [], sources: [] };
  }
}

/** Write the registry. Always to the real file — never back into the example. */
export function saveSources(reg) {
  let base = {};
  try {
    if (existsSync(SOURCES_PATH)) base = JSON.parse(readFileSync(SOURCES_PATH, "utf8"));
    else base = JSON.parse(readFileSync(SOURCES_EXAMPLE_PATH, "utf8"));
  } catch {
    base = {};
  }
  delete base._example;
  delete base._example_sources;
  const out = { ...base, author_emails: reg.authorEmails ?? [], sources: reg.sources ?? [] };
  mkdirSync(dirname(SOURCES_PATH), { recursive: true });
  writeFileSync(SOURCES_PATH, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

function sourceName(entry) {
  if (entry.name) return String(entry.name);
  return String(entry.path).replace(/\/+$/, "").split("/").pop() || entry.path;
}

/**
 * Register a source, or replace the entry with the same name.
 * Returns { registry, entry } so the caller can immediately scan the entry.
 */
export function upsertSource(entry) {
  const reg = loadSources();
  const normalized = {
    kind: entry.kind === "docs" ? "docs" : "repo",
    path: String(entry.path),
    name: sourceName(entry),
    include_globs: Array.isArray(entry.include_globs) ? entry.include_globs : [],
    exclude_globs: Array.isArray(entry.exclude_globs) ? entry.exclude_globs : [],
    since: entry.since || null,
    enabled: entry.enabled === false ? false : true
  };
  const sources = reg.sources.filter((s) => sourceName(s) !== normalized.name);
  sources.push(normalized);
  const authorEmails = entry.author_emails?.length
    ? [...new Set([...reg.authorEmails, ...entry.author_emails.map((e) => e.toLowerCase())])]
    : reg.authorEmails;
  saveSources({ authorEmails, sources });
  return { registry: { ...reg, authorEmails, sources }, entry: normalized };
}

/** Unregister a source and drop its evidence from the corpus. */
export function removeSource(name) {
  const reg = loadSources();
  const kept = reg.sources.filter((s) => sourceName(s) !== name);
  const removed = kept.length !== reg.sources.length;
  if (removed) saveSources({ authorEmails: reg.authorEmails, sources: kept });

  const corpus = loadCorpus();
  const before = corpus.sources.length;
  corpus.sources = corpus.sources.filter((s) => s.name !== name);
  if (corpus.sources.length !== before) saveCorpus(corpus);

  return { removed, name };
}

/** Flatten every scanned source into one evidence array. */
export function allEvidence(corpus = loadCorpus()) {
  const out = [];
  for (const source of corpus.sources ?? []) {
    for (const item of source.evidence ?? []) out.push(item);
  }
  return out;
}

/** Counts by evidence kind, for summaries and the tracker UI. */
export function countByKind(evidence = allEvidence()) {
  const byKind = {};
  for (const item of evidence) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  return byKind;
}

/** Stable id, so rescanning an unchanged source does not churn ids. */
export function evidenceId(sourceName_, kind, text) {
  return createHash("sha1").update(`${sourceName_}\x00${kind}\x00${text}`).digest("hex").slice(0, 12);
}

/** Build an evidence item with every field present, so consumers never guard. */
export function makeEvidence(fields) {
  const sourceName_ = fields.sourceName ?? "";
  const kind = EVIDENCE_KINDS.includes(fields.kind) ? fields.kind : "doc_claim";
  const text = String(fields.text ?? "").trim();
  return {
    id: evidenceId(sourceName_, kind, text),
    sourceName: sourceName_,
    sourceKind: fields.sourceKind === "docs" ? "docs" : "repo",
    kind,
    text,
    verbatim: fields.verbatim ?? null,
    provenance: {
      file: fields.provenance?.file ?? null,
      line: fields.provenance?.line ?? null,
      commit: fields.provenance?.commit ?? null,
      date: fields.provenance?.date ?? null
    },
    tags: [...new Set((fields.tags ?? []).map((t) => String(t).toLowerCase().trim()).filter(Boolean))],
    metrics: fields.metrics && typeof fields.metrics === "object" ? fields.metrics : {},
    dateRange: { start: fields.dateRange?.start ?? null, end: fields.dateRange?.end ?? null },
    confidence: fields.confidence === "verified" ? "verified" : "stated"
  };
}

// --- querying -------------------------------------------------------------

// A tag hit is worth more than a body-text hit: tags are the normalized skill
// the item demonstrates, while text may mention a term only in passing.
const TAG_HIT = 3;
const TEXT_HIT = 1;
const VERBATIM_HIT = 0.5;

// Verified items beat stated ones at equal relevance — a computed git fact is
// safer to put on a resume than a sentence a README asserts about itself.
const CONFIDENCE_BONUS = { verified: 1.5, stated: 0 };

function normalizeKeywords(keywords) {
  // Accepts "a, b", ["a","b"], or [{term,weight}] / {a: 2}. The JD extractor
  // already produces weights, so preserving them is the whole point.
  if (!keywords) return [];
  let list = keywords;
  if (typeof keywords === "string") list = keywords.split(/[,\n]/);
  if (!Array.isArray(list) && typeof list === "object") {
    list = Object.entries(list).map(([term, weight]) => ({ term, weight }));
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((k) => {
      if (typeof k === "string") return { term: k.trim().toLowerCase(), weight: 1 };
      const term = String(k?.term ?? k?.keyword ?? k?.name ?? "").trim().toLowerCase();
      const weight = Number(k?.weight ?? k?.score ?? 1);
      return { term, weight: Number.isFinite(weight) && weight > 0 ? weight : 1 };
    })
    .filter((k) => k.term.length > 1);
}

// Crude suffix stripping, not a real stemmer. A JD says "optimization" and the
// commit says "optimize"; without this they never meet.
function stem(term) {
  if (term.length < 6 || term.includes(" ")) return term;
  return term.replace(/(ization|isation|ations?|ing|ers?|ed|es|s|ion|ize|ise)$/, "");
}

function occurs(haystack, term) {
  if (!haystack) return false;
  // Word-ish boundary so "go" does not match "google" and "c" does not match
  // every word. Terms with regex metachars (c++, .net) fall back to substring.
  if (/^[a-z0-9 ]+$/.test(term)) {
    const root = stem(term);
    const body = root.length >= 4 && root !== term ? `${root}[a-z]{0,7}` : term.replace(/ /g, "[ -]?");
    return new RegExp(`(^|[^a-z0-9])${body}([^a-z0-9]|$)`, "i").test(haystack);
  }
  return haystack.toLowerCase().includes(term);
}

/**
 * queryEvidence(keywords, opts) -> [{ ...evidenceItem, score, matched: [term] }]
 *
 * This is what the resume tailor calls.
 *
 * @param {string|string[]|{term:string,weight:number}[]|Record<string,number>} keywords
 *        JD terms to match. Weighted forms are honored; a bare string is split
 *        on commas/newlines and every term weighted 1.
 * @param {object} [opts]
 * @param {number}   [opts.limit=25]        max items returned
 * @param {string[]} [opts.kinds]           restrict to these evidence kinds
 * @param {string[]} [opts.sources]         restrict to these source names
 * @param {"verified"|"stated"} [opts.confidence]  restrict to this confidence
 * @param {number}   [opts.minScore=0]      drop items scoring at or below this
 * @param {boolean}  [opts.includeUnmatched=false]
 *        true also returns zero-score items (ranked last) — useful when the
 *        caller wants "anything at all" rather than only JD-aligned evidence.
 * @param {object[]} [opts.evidence]        query this array instead of the corpus
 * @returns {Array} best matches, highest score first. Always an array, even
 *        when the corpus is missing or empty.
 */
export function queryEvidence(keywords, opts = {}) {
  const terms = normalizeKeywords(keywords);
  const enabled = new Set(loadSources().sources.filter((source) => source.enabled !== false).map(sourceName));
  const pool = opts.evidence ?? allEvidence().filter((item) => enabled.has(item.sourceName));
  if (!Array.isArray(pool) || pool.length === 0) return [];

  const kinds = opts.kinds?.length ? new Set(opts.kinds) : null;
  const sources = opts.sources?.length ? new Set(opts.sources) : null;
  const limit = Number.isFinite(opts.limit) ? opts.limit : 25;
  const minScore = Number.isFinite(opts.minScore) ? opts.minScore : 0;

  const scored = [];
  for (const item of pool) {
    if (!item || typeof item !== "object") continue;
    if (kinds && !kinds.has(item.kind)) continue;
    if (sources && !sources.has(item.sourceName)) continue;
    if (opts.confidence && item.confidence !== opts.confidence) continue;

    const tagSet = new Set(item.tags ?? []);
    const text = String(item.text ?? "");
    const verbatim = String(item.verbatim ?? "");

    let score = 0;
    const matched = [];
    for (const { term, weight } of terms) {
      let hit = 0;
      if (tagSet.has(term) || [...tagSet].some((t) => occurs(t, term))) hit += TAG_HIT;
      if (occurs(text, term)) hit += TEXT_HIT;
      if (verbatim && occurs(verbatim, term)) hit += VERBATIM_HIT;
      if (hit > 0) {
        score += hit * weight;
        matched.push(term);
      }
    }
    if (score > 0) score += CONFIDENCE_BONUS[item.confidence] ?? 0;
    // Items carrying a real number are the ones that make a resume bullet land.
    if (score > 0 && Object.keys(item.metrics ?? {}).length > 0) score += 1;

    if (score <= minScore && !opts.includeUnmatched) continue;
    scored.push({ ...item, score: Math.round(score * 100) / 100, matched });
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, limit);
}

export { CORPUS_PATH, SOURCES_PATH, SOURCES_EXAMPLE_PATH, sourceName };
