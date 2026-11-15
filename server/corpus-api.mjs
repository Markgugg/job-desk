/**
 * Pure functions over the evidence corpus, for the server to import.
 *
 * No HTTP, no process.exit, no console output: this module is the seam between
 * the corpus and whatever calls it. Every function returns a plain object and
 * NONE of them throw — a candidate who has never run a scan must get empty
 * structures, not a 500 in the middle of an application run.
 */
import {
  loadCorpus, saveCorpus, loadSources, upsertSource, removeSource as removeSourceFromStore,
  allEvidence, countByKind, queryEvidence, sourceName
} from "./corpus-store.mjs";
import { ingestSource } from "./corpus-ingest.mjs";

/** Everything the UI needs to render the corpus panel. */
export function corpusState() {
  try {
    const corpus = loadCorpus();
    const registry = loadSources();
    const scannedByName = new Map((corpus.sources ?? []).map((s) => [s.name, s]));

    // Registered-but-never-scanned sources still belong in the list, with a
    // zero count — otherwise adding a source looks like it did nothing.
    const names = new Set([...scannedByName.keys(), ...registry.sources.map(sourceName)]);
    const sources = [...names].map((name) => {
      const scanned = scannedByName.get(name);
      const registered = registry.sources.find((s) => sourceName(s) === name);
      return {
        name,
        kind: scanned?.kind ?? registered?.kind ?? "repo",
        path: scanned?.path ?? registered?.path ?? null,
        evidenceCount: scanned?.evidence?.length ?? 0,
        lastScanned: scanned?.lastScanned ?? null,
        error: scanned?.error ?? null,
        notes: scanned?.notes ?? [],
        registered: Boolean(registered),
        enabled: registered ? registered.enabled !== false : false
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const evidence = allEvidence(corpus);
    return {
      sources,
      totals: {
        sources: sources.length,
        evidence: evidence.length,
        byKind: countByKind(evidence),
        byConfidence: evidence.reduce((acc, e) => {
          acc[e.confidence] = (acc[e.confidence] ?? 0) + 1;
          return acc;
        }, {})
      },
      authorEmails: registry.authorEmails,
      registryIsExample: registry.isExample,
      lastScanned: corpus.lastScanned ?? null
    };
  } catch {
    return { sources: [], totals: { sources: 0, evidence: 0, byKind: {}, byConfidence: {} }, authorEmails: [], registryIsExample: true, lastScanned: null };
  }
}

/** Register a source. Does not scan — call scanSource(name) after. */
export function addSource(entry) {
  try {
    if (!entry?.path) return { ok: false, error: "path is required" };
    const { entry: normalized } = upsertSource(entry);
    return { ok: true, source: normalized };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Unregister a source and drop its evidence. */
export function removeSource(name) {
  try {
    const res = removeSourceFromStore(name);
    return { ok: res.removed, name, error: res.removed ? null : `no source named "${name}"` };
  } catch (err) {
    return { ok: false, name, error: String(err?.message ?? err) };
  }
}

function replaceSourceResult(corpus, result) {
  const sources = (corpus.sources ?? []).filter((s) => s.name !== result.name);
  sources.push(result);
  return { ...corpus, sources, lastScanned: new Date().toISOString() };
}

/** Rescan one registered source and merge its result into the corpus. */
export function scanSource(name) {
  try {
    const registry = loadSources();
    const entry = registry.sources.find((s) => sourceName(s) === name);
    if (!entry) return { ok: false, error: `no source named "${name}"` };
    if (entry.enabled === false) return { ok: false, error: `source "${name}" is disabled` };
    const result = ingestSource(entry, registry.authorEmails);
    saveCorpus({ ...replaceSourceResult(loadCorpus(), result), authorEmails: registry.authorEmails });
    return { ok: !result.error, source: summarize(result), error: result.error };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Rescan every enabled source and rewrite the corpus from scratch. */
export function scanAll() {
  try {
    const registry = loadSources();
    const enabled = registry.sources.filter((s) => s.enabled !== false);
    const skipped = registry.sources.filter((s) => s.enabled === false).map(sourceName);
    const results = enabled.map((entry) => ingestSource(entry, registry.authorEmails));
    // A full scan rewrites sources wholesale, so an unregistered source's stale
    // evidence cannot survive.
    saveCorpus({ version: 1, lastScanned: new Date().toISOString(), authorEmails: registry.authorEmails, sources: results });
    return {
      ok: results.every((result) => !result.error),
      scanned: results.map(summarize),
      skipped,
      totals: { evidence: results.reduce((n, r) => n + r.evidence.length, 0), byKind: countByKind(results.flatMap((r) => r.evidence)) },
      warnings: registry.authorEmails.length === 0 && enabled.some((s) => s.kind === "repo")
        ? ["author_emails is empty — git facts were skipped for every repo source"]
        : []
    };
  } catch (err) {
    return { ok: false, scanned: [], skipped: [], totals: { evidence: 0, byKind: {} }, warnings: [], error: String(err?.message ?? err) };
  }
}

/** Refresh registered inputs before tailoring, at most once per five minutes. */
export function ensureFreshCorpus({ maxAgeMs = 300000 } = {}) {
  const registry = loadSources();
  const scanned = new Map(loadCorpus().sources.map((source) => [source.name, source]));
  const due = registry.sources.filter((entry) => {
    if (entry.enabled === false) return false;
    const previous = scanned.get(sourceName(entry));
    return !previous || previous.path !== entry.path || !Number.isFinite(Date.parse(previous.lastScanned)) || Date.now() - Date.parse(previous.lastScanned) > maxAgeMs || !!previous.error;
  });
  return due.map((entry) => scanSource(sourceName(entry)));
}

function summarize(result) {
  return {
    name: result.name,
    kind: result.kind,
    path: result.path,
    evidenceCount: result.evidence.length,
    byKind: countByKind(result.evidence),
    stats: result.stats ?? {},
    notes: result.notes ?? [],
    error: result.error ?? null,
    lastScanned: result.lastScanned ?? null
  };
}

export { queryEvidence };
