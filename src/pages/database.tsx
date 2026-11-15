import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { EmptyState, Notice, SectionHead, StatCard } from "@/components/bits";
import { ConfidenceRings, HorizontalBars, VerticalBars } from "@/components/charts";
import { isPreview, previewCorpus, previewEvidence } from "@/lib/preview";
import {
  Boxes,
  Database as DatabaseIcon,
  FileCode2,
  FileText,
  FolderSearch,
  GitCommitHorizontal,
  Search,
  ChevronRight,
  Tags,
  X,
  type LucideIcon
} from "lucide-react";
import {
  NotBuiltError,
  deleteOptional,
  getOptional,
  postOptional,
  type CorpusFacets,
  type CorpusState,
  type Evidence,
  type FacetBucket
} from "@/lib/api";
import {
  evidenceByConfidence,
  evidenceByKind,
  evidencePerSource,
  formatDay,
  formatWhen,
  sourceRemainder
} from "@/lib/format";

type Status = "loading" | "ready" | "missing" | "error";

/** The evidence list can run to thousands of rows, so it pages. */
const PAGE = 50;

/** How many keyword chips to show before the overview collapses. */
const TAG_PREVIEW = 18;

/** Ask for a generous window; the filters, not the limit, are how you narrow. */
const QUERY_LIMIT = 500;

const KIND_LABELS: Record<string, string> = {
  repo: "Repository — code and git history",
  docs: "Notes — markdown and docs"
};

const CONFIDENCE_LABELS: Record<string, string> = {
  all: "Everything",
  verified: "Verified only",
  stated: "Stated only"
};
type Confidence = "all" | "verified" | "stated";

function kindLabel(kind?: string) {
  return ({ repo: "From code", docs: "From notes" } as Record<string, string>)[kind || ""] ||
    String(kind || "").replaceAll("_", " ");
}

/** The evidence kinds the extractor emits, in plain words. */
const EVIDENCE_KIND_LABELS: Record<string, string> = {
  metric: "Metric",
  doc_claim: "Doc claim",
  stack: "Stack",
  scale: "Scale",
  commit: "Commit",
  role: "Role"
};

function evidenceKindLabel(kind?: string) {
  const key = String(kind || "");
  return EVIDENCE_KIND_LABELS[key] || key.replaceAll("_", " ") || "—";
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Facets computed client-side, for preview mode and as a fallback. */
export function facetsFromRows(rows: Evidence[]): CorpusFacets {
  const count = (values: (string | undefined)[]) => {
    const map = new Map<string, number>();
    for (const value of values) {
      const key = String(value || "").trim();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ name, count: n }));
  };
  return {
    available: true,
    total: rows.length,
    sources: count(rows.map((row) => row.sourceName)),
    kinds: count(rows.map((row) => row.kind)),
    tags: count(rows.flatMap((row) => row.tags || [])),
    confidence: count(rows.map((row) => row.confidence || "stated"))
  };
}

export function filterEvidence(rows: Evidence[] | null, confidence: Confidence): Evidence[] {
  const list = Array.isArray(rows) ? rows : [];
  if (confidence === "all") return list;
  return list.filter((row) => (row.confidence || "stated") === confidence);
}

export function DatabasePage() {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const [corpus, setCorpus] = useState<CorpusState | null>(null);
  const [scanning, setScanning] = useState("");
  const [query, setQuery] = useState("");
  const [confidence, setConfidence] = useState<Confidence>("all");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [facets, setFacets] = useState<CorpusFacets | null>(null);
  const [showAllTags, setShowAllTags] = useState(false);
  const [results, setResults] = useState<Evidence[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("repo");
  const [path, setPath] = useState("");

  const preview = isPreview();

  const load = useCallback(async () => {
    setStatus("loading");
    if (preview) {
      setCorpus(previewCorpus());
      setStatus("ready");
      return;
    }
    try {
      const data = await getOptional<CorpusState>("/api/corpus/state");
      setCorpus(data);
      if (data?.available === false) {
        setStatus("missing");
        setMessage(data.error || "The evidence database is not installed yet.");
      } else {
        setStatus("ready");
      }
    } catch (err) {
      if (err instanceof NotBuiltError) {
        setStatus("missing");
        setMessage(err.message);
      } else {
        setStatus("error");
        setMessage(String((err as Error).message || err));
      }
    }
  }, [preview]);

  const loadFacets = useCallback(async () => {
    if (preview) {
      setFacets(facetsFromRows(previewEvidence()));
      return;
    }
    try {
      const data = await getOptional<CorpusFacets>("/api/corpus/facets");
      setFacets(data?.available === false ? null : data);
    } catch {
      // Facets are an aid, not a requirement: the browser still works without them.
      setFacets(null);
    }
  }, [preview]);

  useEffect(() => {
    void load();
  }, [load]);

  function handle(err: unknown) {
    if (err instanceof NotBuiltError) {
      setStatus("missing");
      setMessage(err.message);
      toast.error(err.message);
      return;
    }
    toast.error(String((err as Error).message || err));
  }

  const runSearch = useCallback(
    async (options?: {
      q?: string;
      sources?: string[];
      kinds?: string[];
      tags?: string[];
      confidence?: Confidence;
    }) => {
      const q = (options?.q ?? query).trim();
      const sources = options?.sources ?? selectedSources;
      const kinds = options?.kinds ?? selectedKinds;
      const tags = options?.tags ?? selectedTags;
      const level = options?.confidence ?? confidence;
      // Tags are keywords: they join the free-text terms.
      const terms = [...q.split(",").map((part) => part.trim()).filter(Boolean), ...tags];

      setSearching(true);
      setVisible(PAGE);

      if (preview) {
        const rows = previewEvidence().filter((row: Evidence) => {
          if (sources.length && !sources.includes(String(row.sourceName || ""))) return false;
          if (kinds.length && !kinds.includes(String(row.kind || ""))) return false;
          if (level !== "all" && (row.confidence || "stated") !== level) return false;
          if (!terms.length) return true;
          const hay = `${row.text} ${(row.tags || []).join(" ")}`.toLowerCase();
          return terms.some((term) => hay.includes(term.toLowerCase()));
        });
        setResults(rows);
        setSearching(false);
        return;
      }

      const params = new URLSearchParams();
      params.set("q", terms.join(","));
      if (sources.length) params.set("sources", sources.join(","));
      if (kinds.length) params.set("kinds", kinds.join(","));
      if (level !== "all") params.set("confidence", level);
      if (!terms.length) params.set("all", "1");
      params.set("limit", String(QUERY_LIMIT));

      try {
        const data = await getOptional<{ results?: Evidence[] }>(`/api/corpus/query?${params}`);
        const rows = Array.isArray(data.results) ? data.results : [];
        setResults(rows);
        if (!rows.length) toast("No evidence matched these filters");
      } catch (err) {
        setResults([]);
        handle(err);
      } finally {
        setSearching(false);
      }
    },
    [confidence, preview, query, selectedKinds, selectedSources, selectedTags]
  );

  // Browsing with no keywords is a first-class path, so the list starts full.
  useEffect(() => {
    if (status !== "ready") return;
    void loadFacets();
    void runSearch({ q: "", sources: [], kinds: [], tags: [], confidence: "all" });
    // Only on the first successful load of the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function applyFilters(next: {
    sources?: string[];
    kinds?: string[];
    tags?: string[];
    confidence?: Confidence;
    q?: string;
  }) {
    if (next.sources) setSelectedSources(next.sources);
    if (next.kinds) setSelectedKinds(next.kinds);
    if (next.tags) setSelectedTags(next.tags);
    if (next.confidence) setConfidence(next.confidence);
    if (next.q !== undefined) setQuery(next.q);
    void runSearch(next);
  }

  function clearFilters() {
    setQuery("");
    setSelectedSources([]);
    setSelectedKinds([]);
    setSelectedTags([]);
    setConfidence("all");
    void runSearch({ q: "", sources: [], kinds: [], tags: [], confidence: "all" });
  }

  async function addSource(event: React.FormEvent) {
    event.preventDefault();
    if (preview) {
      toast.error("Preview mode", { description: "Sample data only — adding sources is disabled." });
      return;
    }
    if (!path.trim().startsWith("/")) {
      toast.error("Use an absolute path, starting with /");
      return;
    }
    try {
      const data = await postOptional<CorpusState>("/api/corpus/source", {
        name: name.trim(),
        kind,
        path: path.trim()
      });
      setCorpus(data);
      setStatus(data?.available === false ? "missing" : "ready");
      toast.success(`Added ${name.trim()}`);
      setName("");
      setPath("");
    } catch (err) {
      handle(err);
    }
  }

  async function removeSource(sourceName: string) {
    if (preview) {
      toast.error("Preview mode", { description: "Sample data only — removing sources is disabled." });
      return;
    }
    try {
      const data = await deleteOptional<CorpusState>(
        `/api/corpus/source?name=${encodeURIComponent(sourceName)}`
      );
      setCorpus(data);
      toast.success(`Removed ${sourceName}`);
    } catch (err) {
      handle(err);
    }
  }

  async function scan(sourceName?: string) {
    if (preview) {
      toast.error("Preview mode", { description: "Sample data only — scanning is disabled." });
      return;
    }
    setScanning(sourceName || "all");
    try {
      const data = await postOptional<{
        scanned?: { evidenceCount?: number; error?: string }[];
        source?: { evidenceCount?: number; error?: string };
        totals?: { evidence?: number };
        skipped?: unknown[];
        error?: string;
      }>("/api/corpus/scan", sourceName ? { name: sourceName } : {});
      const rows = data.source ? [data.source] : data.scanned || [];
      const errors = [...rows.filter((row) => row.error), ...(data.error ? [{ error: data.error }] : [])];
      const skipped = data.skipped || [];
      toast[errors.length ? "error" : "success"](
        `Scanned ${rows.length} source${rows.length === 1 ? "" : "s"} · ${data.totals?.evidence ?? data.source?.evidenceCount ?? 0} facts${
          skipped.length ? ` · ${skipped.length} skipped` : ""
        }`,
        errors.length ? { description: String(errors[0]?.error || errors[0]) } : undefined
      );
    } catch (err) {
      handle(err);
    } finally {
      setScanning("");
      await load();
      await loadFacets();
      if (results !== null) await runSearch();
    }
  }

  const activeFilterCount =
    (query.trim() ? 1 : 0) +
    selectedSources.length +
    selectedKinds.length +
    selectedTags.length +
    (confidence === "all" ? 0 : 1);

  function confidenceCount(level: Confidence) {
    if (level === "all") return facets?.total ? ` (${facets.total})` : "";
    const bucket = (facets?.confidence || []).find((row) => row.name === level);
    return bucket ? ` (${bucket.count})` : "";
  }

  const sources = corpus?.sources || [];
  const total = sources.reduce((sum, s) => sum + Number(s.evidenceCount || 0), 0);
  // The server already applied `confidence`; this is a belt-and-braces pass so a
  // "verified only" view can never show a stated row.
  const rows = filterEvidence(results, confidence);
  const verified = rows.filter((r) => r.confidence === "verified").length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => void load()} disabled={status === "loading"}>
          {status === "loading" ? "Loading…" : "Refresh"}
        </Button>
        <Button onClick={() => scan()} disabled={Boolean(scanning) || status !== "ready"}>
          {scanning === "all" ? "Scanning…" : "Rescan all"}
        </Button>
      </div>

      {status === "missing" ? (
        <Notice>
          <p>
            <strong>Evidence is not available.</strong> {message}
          </p>
        </Notice>
      ) : null}
      {status === "error" ? (
        <Notice tone="bad">
          <p>
            <strong>Could not read the evidence store.</strong> {message}
          </p>
        </Notice>
      ) : null}
      {scanning ? (
        <Notice>
          <p>
            <strong>Scanning {scanning === "all" ? "every source" : scanning}…</strong> This reads real files and git
            history, so it can take a few seconds.
          </p>
        </Notice>
      ) : null}

      {sources.length ? (
        <section className="grid gap-3 sm:grid-cols-3" aria-label="Evidence totals">
          <StatCard label="Sources" value={sources.length} />
          <StatCard label="Evidence items" value={total} />
          <StatCard label="Last scanned" value={<span className="text-base">{formatWhen(corpus?.lastScanned)}</span>} />
        </section>
      ) : null}


      {status === "loading" ? (
        <EmptyState icon={DatabaseIcon} title="Loading sources…" note="Reading the local evidence store." />
      ) : sources.length === 0 ? (
        <EmptyState
          icon={FolderSearch}
          title="No sources connected"
          note={
            status === "missing"
              ? "Nothing is registered because the evidence database is not installed yet."
              : "Add a repository or a folder of project notes below to start building the store."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((source) => {
            const busy = scanning === source.name || scanning === "all";
            return (
              <Card key={source.name} className={cn("gap-2.5 p-5", source.error && "border-destructive")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="bg-[color-mix(in_oklab,var(--info)_14%,transparent)] text-[var(--info)] inline-flex rounded-full border border-[color-mix(in_oklab,var(--info)_28%,transparent)] px-2.5 py-0.5 text-xs font-semibold">
                      {kindLabel(source.kind)}
                    </span>
                    <h3 className="mt-1.5 text-sm font-semibold">{source.name || "Unnamed source"}</h3>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">
                    {source.evidenceCount ?? 0}
                    <span className="text-muted-foreground ml-1 text-xs font-medium">facts</span>
                  </p>
                </div>
                <p className="text-muted-foreground font-mono text-xs break-all">{source.path || "—"}</p>
                <p className="text-muted-foreground text-xs">Last scanned {formatWhen(source.lastScanned)}</p>
                {source.error ? (
                  <p className="text-destructive rounded-md bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] p-2 text-xs">
                    {source.error}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => scan(source.name)}>
                    {scanning === source.name ? "Scanning…" : "Rescan"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => removeSource(source.name)}>
                    Remove
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <form onSubmit={addSource} className="bg-card grid gap-3 rounded-xl border p-5 shadow-sm sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="corpus-name">Name</Label>
          <Input
            id="corpus-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-project"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="corpus-kind">Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v ?? "repo")}>
            <SelectTrigger id="corpus-kind" className="w-full">
              <SelectValue>{KIND_LABELS[kind] ?? kind}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="repo">Repository — code and git history</SelectItem>
              <SelectItem value="docs">Notes — markdown and docs</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="corpus-path">Absolute path</Label>
          <Input
            id="corpus-path"
            required
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/you/projects/thing"
          />
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" disabled={Boolean(scanning)}>
            Add source
          </Button>
        </div>
      </form>

      <details className="rounded-xl border p-5"><summary className="cursor-pointer font-medium">Evidence insights</summary><div className="mt-4">      <section className="grid gap-3 lg:grid-cols-2">
        <ConfidenceRings data={evidenceByConfidence(corpus?.totals?.byConfidence)} />
        <VerticalBars
          icon={FileCode2}
          title="Evidence by kind"
          description="Where the facts came from"
          data={evidenceByKind(corpus?.totals?.byKind)}
          series={[{ dataKey: "evidence", fill: "var(--chart-2)" }]}
          loading={Boolean(scanning)}
          emptyNote="No evidence extracted yet. Add a source and run a scan."
        />
        <HorizontalBars
          icon={Boxes}
          title="Evidence per source"
          description="Which projects carry the most proof"
          data={evidencePerSource(sources)}
          dataKey="evidence"
          fill="var(--chart-3)"
          loading={Boolean(scanning)}
          emptyNote="Connect a repository or a notes folder to populate this."
          footer={(() => {
            const rest = sourceRemainder(sources);
            return rest.sources
              ? `Top 10 shown. ${rest.sources} more sources hold ${rest.evidence} further items.`
              : undefined;
          })()}
        />
      </section>
</div></details>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-5"><p className="text-sm">See how your evidence lines up with each job.</p><a href="#resume" className="text-sm font-medium underline">Open Resume →</a></div>
      <section>
        <SectionHead
          icon={Search}
          title="Evidence"
          note="Browse every extracted fact. Filter by source, kind, skill or confidence — each item traces back to the file it came from."
        />

        {/* Skills overview: what the corpus knows you can do. */}
        {(facets?.tags || []).length ? (
          <Card className="mb-3">
            <CardHeader>
              <CardDescription className="flex items-center gap-1.5">
                <Tags className="size-3.5" aria-hidden />
                {(facets?.tags || []).length} distinct skills across {facets?.total ?? 0} items
              </CardDescription>
              <CardTitle>Skills and keywords</CardTitle>
              {(facets?.tags || []).length > TAG_PREVIEW ? (
                <CardAction>
                  <Button variant="ghost" size="sm" onClick={() => setShowAllTags((v) => !v)}>
                    {showAllTags ? "Show top" : `Show all ${(facets?.tags || []).length}`}
                  </Button>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {(showAllTags ? facets?.tags || [] : (facets?.tags || []).slice(0, TAG_PREVIEW)).map(
                  (tag: FacetBucket) => {
                    const on = selectedTags.includes(tag.name);
                    return (
                      <button
                        key={tag.name}
                        type="button"
                        aria-pressed={on}
                        onClick={() => applyFilters({ tags: toggle(selectedTags, tag.name) })}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                          on
                            ? "bg-primary text-primary-foreground border-transparent font-medium"
                            : "bg-background hover:bg-accent text-foreground"
                        )}
                      >
                        {tag.name}
                        <span className={cn("tabular-nums", on ? "opacity-80" : "text-muted-foreground")}>
                          {tag.count}
                        </span>
                      </button>
                    );
                  }
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Filter bar. Counts come from the facets endpoint, so the weight is
            visible before anything is clicked. */}
        <Card className="mb-3">
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <Search className="size-3.5" aria-hidden />
              Narrow the store
            </CardDescription>
            <CardTitle>Filters</CardTitle>
            {activeFilterCount ? (
              <CardAction>
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="mr-1 size-3.5" aria-hidden />
                  Clear all
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
              className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
            >
              <div className="grid gap-1.5">
                <Label htmlFor="corpus-q">Keywords</Label>
                <Input
                  id="corpus-q"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Leave empty to browse everything"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="corpus-confidence">Confidence</Label>
                <Select
                  value={confidence}
                  onValueChange={(v) => applyFilters({ confidence: (v ?? "all") as Confidence })}
                >
                  <SelectTrigger id="corpus-confidence" className="w-full">
                    <SelectValue>{CONFIDENCE_LABELS[confidence]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everything{confidenceCount("all")}</SelectItem>
                    <SelectItem value="verified">Verified only{confidenceCount("verified")}</SelectItem>
                    <SelectItem value="stated">Stated only{confidenceCount("stated")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" variant="outline" disabled={searching}>
                {searching ? "Searching…" : "Search"}
              </Button>
            </form>

            {(facets?.sources || []).length ? (
              <div className="grid gap-1.5">
                <p className="text-muted-foreground text-xs font-medium">Source</p>
                <div className="flex flex-wrap gap-1.5">
                  {(facets?.sources || []).map((source: FacetBucket) => (
                    <FilterChip
                      key={source.name}
                      label={source.name}
                      count={source.count}
                      icon={Boxes}
                      active={selectedSources.includes(source.name)}
                      onClick={() => applyFilters({ sources: toggle(selectedSources, source.name) })}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {(facets?.kinds || []).length ? (
              <div className="grid gap-1.5">
                <p className="text-muted-foreground text-xs font-medium">Kind of fact</p>
                <div className="flex flex-wrap gap-1.5">
                  {(facets?.kinds || []).map((kindBucket: FacetBucket) => (
                    <FilterChip
                      key={kindBucket.name}
                      label={evidenceKindLabel(kindBucket.name)}
                      count={kindBucket.count}
                      icon={kindBucket.name === "commit" ? GitCommitHorizontal : FileText}
                      active={selectedKinds.includes(kindBucket.name)}
                      onClick={() => applyFilters({ kinds: toggle(selectedKinds, kindBucket.name) })}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
          {activeFilterCount ? (
            <CardFooter className="flex-wrap gap-2 text-xs">
              <span className="text-muted-foreground">Filtering by</span>
              {query.trim() ? <ActiveChip onClear={() => applyFilters({ q: "" })}>“{query.trim()}”</ActiveChip> : null}
              {selectedSources.map((name) => (
                <ActiveChip key={name} onClear={() => applyFilters({ sources: toggle(selectedSources, name) })}>
                  source: {name}
                </ActiveChip>
              ))}
              {selectedKinds.map((name) => (
                <ActiveChip key={name} onClear={() => applyFilters({ kinds: toggle(selectedKinds, name) })}>
                  kind: {evidenceKindLabel(name)}
                </ActiveChip>
              ))}
              {selectedTags.map((name) => (
                <ActiveChip key={name} onClear={() => applyFilters({ tags: toggle(selectedTags, name) })}>
                  skill: {name}
                </ActiveChip>
              ))}
              {confidence !== "all" ? (
                <ActiveChip onClear={() => applyFilters({ confidence: "all" })}>{confidence} only</ActiveChip>
              ) : null}
            </CardFooter>
          ) : null}
        </Card>

        {searching ? (
          <EmptyState icon={Search} title="Searching…" note="Reading the evidence store." />
        ) : results === null ? (
          <EmptyState
            icon={DatabaseIcon}
            title="Nothing loaded yet"
            note={
              status === "missing"
                ? "Search will work once the evidence database is installed."
                : "Press Search to browse the store."
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FolderSearch}
            title="No evidence matched"
            note="Nothing in the store fits these filters."
            action={
              activeFilterCount ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="text-muted-foreground mb-2 text-xs">
              {rows.length} item{rows.length === 1 ? "" : "s"} · {verified} verified ·{" "}
              {rows.length - verified} stated
              {facets?.total && rows.length !== facets.total ? ` · ${facets.total} in the store` : ""}
            </p>
            <div className="bg-card ring-foreground/10 max-h-[70vh] overflow-auto rounded-xl shadow-xs ring-1">
              <table className="w-full table-fixed border-collapse text-sm md:min-w-[640px]">
                <thead className="bg-card sticky top-0 z-10">
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th scope="col" className="w-[124px] py-2 pr-3 pl-3 font-medium">
                      Confidence
                    </th>
                    <th scope="col" className="hidden w-[130px] py-2 pr-2 font-medium md:table-cell">
                      Source
                    </th>
                    <th scope="col" className="hidden w-[96px] py-2 pr-2 font-medium lg:table-cell">
                      Kind
                    </th>
                    <th scope="col" className="py-2 pr-2 font-medium">
                      Fact
                    </th>
                    <th scope="col" className="hidden w-[150px] py-2 pr-2 font-medium xl:table-cell">
                      Skills
                    </th>
                    <th scope="col" className="hidden w-[190px] py-2 pr-2 font-medium lg:table-cell">
                      Where
                    </th>
                    <th scope="col" className="hidden w-[84px] py-2 pr-3 text-right font-medium xl:table-cell">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, visible).map((row) => (
                    <EvidenceRow
                      key={row.id}
                      row={row}
                      open={expanded === row.id}
                      onToggle={() => setExpanded((current) => (current === row.id ? null : row.id))}
                      onTag={(tag) => applyFilters({ tags: toggle(selectedTags, tag) })}
                      onSource={(source) => applyFilters({ sources: toggle(selectedSources, source) })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > visible ? (
              <div className="mt-3 flex items-center gap-3">
                <Button variant="outline" onClick={() => setVisible((n) => n + PAGE)}>
                  Show {Math.min(PAGE, rows.length - visible)} more
                </Button>
                <span className="text-muted-foreground text-xs">
                  Showing {visible} of {rows.length}
                </span>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function FilterChip({
  label,
  count,
  icon: Icon,
  active,
  onClick
}: {
  label: string;
  count: number;
  icon?: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "bg-primary text-primary-foreground border-transparent font-medium"
          : "bg-background hover:bg-accent text-foreground"
      )}
    >
      {Icon ? <Icon className="size-3.5 opacity-70" aria-hidden /> : null}
      {label}
      <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}

function ActiveChip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <span className="bg-muted inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5">
      {children}
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove this filter"
        className="hover:bg-background rounded-full p-0.5"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

/** Keep the filename visible when a long path has to be cut. */
function shortPath(file?: string, line?: number | null) {
  const raw = String(file || "");
  if (!raw) return "";
  const parts = raw.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  const shown = parts.length > 2 ? `…/${tail}` : tail;
  return line ? `${shown}:${line}` : shown;
}

function metricRows(metrics?: Record<string, unknown>) {
  return Object.entries(metrics || {}).map(([key, value]) => {
    const readable =
      value && typeof value === "object"
        ? [(value as { value?: unknown }).value, (value as { unit?: unknown }).unit]
            .filter((part) => part !== null && part !== undefined && part !== "")
            .join(" ")
        : String(value ?? "");
    return { key, readable };
  });
}

/**
 * One fact, one line. Verified vs stated stays instantly readable as a coloured
 * dot with a real label for screen readers; everything wordy lives in the
 * expand, so the table can be scanned rather than read.
 */
function EvidenceRow({
  row,
  open,
  onToggle,
  onTag,
  onSource
}: {
  row: Evidence;
  open: boolean;
  onToggle: () => void;
  onTag: (tag: string) => void;
  onSource: (source: string) => void;
}) {
  const verified = row.confidence === "verified";
  const p = row.provenance || {};
  const tags = row.tags || [];
  const snippet = typeof row.verbatim === "string" ? row.verbatim : "";
  const metrics = metricRows(row.metrics);
  const detailId = `evidence-detail-${row.id}`;

  return (
    <>
      <tr
        className={cn(
          "hover:bg-accent/60 cursor-pointer border-b transition-colors",
          open && "bg-accent/40"
        )}
        onClick={onToggle}
      >
        <td className="py-2 pr-3 pl-3 align-middle">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            className="hover:bg-background -ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5"
            title={verified ? "Verified — computed from files or git history" : "Stated — claimed in notes"}
          >
            <ChevronRight
              className={cn("text-muted-foreground size-3.5 transition-transform", open && "rotate-90")}
              aria-hidden
            />
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: verified ? "var(--ok)" : "var(--warn)" }}
              aria-hidden
            />
            <span className="sr-only">{verified ? "Verified" : "Stated"}</span>
            <span
              aria-hidden
              className={cn(
                "hidden text-[11px] font-semibold tracking-wide uppercase sm:inline",
                verified ? "text-[var(--ok)]" : "text-[var(--warn)]"
              )}
            >
              {verified ? "Verified" : "Stated"}
            </span>
          </button>
        </td>

        <td className="hidden py-2 pr-2 align-middle md:table-cell">
          {row.sourceName ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSource(String(row.sourceName));
              }}
              title={`Filter to ${row.sourceName}`}
              className="hover:text-foreground text-muted-foreground block max-w-full truncate text-left"
            >
              {row.sourceName}
            </button>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        <td className="text-muted-foreground hidden py-2 pr-2 align-middle whitespace-nowrap lg:table-cell">
          {evidenceKindLabel(row.kind)}
        </td>

        <td className="py-2 pr-2 align-middle">
          <span className="block truncate" title={row.text || ""}>
            {row.text || "—"}
          </span>
        </td>

        <td className="hidden py-2 pr-2 align-middle xl:table-cell">
          <span className="flex items-center gap-1 overflow-hidden">
            {tags.slice(0, 2).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onTag(tag);
                }}
                title={`Filter to ${tag}`}
                className="bg-muted text-muted-foreground hover:bg-accent hover:text-foreground max-w-[70px] truncate rounded-full px-2 py-0.5 text-xs"
              >
                {tag}
              </button>
            ))}
            {tags.length > 2 ? (
              <span className="text-muted-foreground text-xs" title={tags.join(", ")}>
                +{tags.length - 2}
              </span>
            ) : null}
            {tags.length === 0 ? <span className="text-muted-foreground text-xs">—</span> : null}
          </span>
        </td>

        <td className="text-muted-foreground hidden py-2 pr-2 align-middle lg:table-cell">
          <code
            className="block truncate bg-transparent p-0 text-xs"
            title={[p.file, p.line ? `line ${p.line}` : ""].filter(Boolean).join(" · ")}
          >
            {shortPath(p.file, p.line) || "—"}
          </code>
        </td>

        <td className="text-muted-foreground hidden py-2 pr-3 text-right align-middle text-xs whitespace-nowrap tabular-nums xl:table-cell">
          {row.dateRange?.end ? formatDay(row.dateRange.end) : "—"}
        </td>
      </tr>

      {open ? (
        <tr id={detailId} className="bg-muted/40 border-b">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid gap-2.5">
              <p className="text-sm leading-relaxed">{row.text || "—"}</p>

              {snippet && snippet !== row.text ? (
                <p className="bg-background text-muted-foreground overflow-x-auto rounded-md border px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">
                  {snippet}
                </p>
              ) : null}

              {metrics.length ? (
                <div className="text-muted-foreground flex flex-wrap gap-3.5 text-xs">
                  {metrics.map((metric) => (
                    <span key={metric.key}>
                      <b className="text-foreground tabular-nums">{metric.readable}</b>{" "}
                      {metric.key.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              ) : null}

              {tags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => onTag(tag)}
                      title={`Filter to ${tag}`}
                      className="bg-muted text-muted-foreground hover:bg-accent hover:text-foreground rounded-full px-2 py-0.5 text-xs"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {row.sourceName ? (
                  <button
                    type="button"
                    onClick={() => onSource(String(row.sourceName))}
                    className="hover:text-foreground inline-flex items-center gap-1.5"
                  >
                    <Boxes className="size-3 opacity-70" aria-hidden />
                    {row.sourceName}
                  </button>
                ) : null}
                <span>{evidenceKindLabel(row.kind)}</span>
                {p.file ? (
                  <code className="bg-transparent p-0 break-all">
                    {p.file}
                    {p.line ? ` · line ${p.line}` : ""}
                  </code>
                ) : (
                  <span>No file recorded</span>
                )}
                {p.commit ? (
                  <code title="Commit" className="bg-transparent p-0">
                    <GitCommitHorizontal className="mr-1 inline size-3" aria-hidden />
                    {String(p.commit).slice(0, 10)}
                  </code>
                ) : null}
                {row.dateRange?.end ? <span>{formatWhen(row.dateRange.end)}</span> : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
