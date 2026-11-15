import { useCallback, useEffect, useState } from "react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataList, DataRow, EmptyState, Notice, SectionHead, StatusPill } from "@/components/bits";
import { HorizontalBars, VerticalBars } from "@/components/charts";
import { FileText, Gauge, Layers, TriangleAlert } from "lucide-react";
import {
  NotBuiltError,
  getOptional,
  type Evidence,
  type ResumeState,
  type TailoredResume
} from "@/lib/api";
import { isPreview, previewResume } from "@/lib/preview";
import {
  formatDay,
  indexEvidence,
  keywordCoverage,
  resumeScores,
  scoreTone,
  topMissingKeywords,
  type EvidenceHit
} from "@/lib/format";

type Status = "loading" | "ready" | "missing" | "error";

interface Selected extends TailoredResume {
  label: string;
}

export function ResumePage() {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const [resume, setResume] = useState<ResumeState | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [evidence, setEvidence] = useState<Map<string, EvidenceHit> | null>(null);

  const previewMode = isPreview();

  const load = useCallback(async () => {
    setStatus("loading");
    if (previewMode) {
      setResume(previewResume());
      setStatus("ready");
      return;
    }
    try {
      setResume(await getOptional<ResumeState>("/api/resume/state"));
      setStatus("ready");
    } catch (err) {
      setStatus(err instanceof NotBuiltError ? "missing" : "error");
      setMessage(String((err as Error).message || err));
    }
  }, [previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadEvidence(matched?: string[]) {
    if (!Array.isArray(matched) || !matched.length || previewMode) {
      setEvidence(null);
      return;
    }
    try {
      const data = await getOptional<{ results?: Evidence[] }>(
        `/api/corpus/query?q=${encodeURIComponent(matched.join(","))}&limit=200`
      );
      setEvidence(indexEvidence(matched, data.results));
    } catch {
      // No evidence store, no claims about backing. Silence is the honest state.
      setEvidence(null);
    }
  }

  async function inspect(row: TailoredResume) {
    setSelected({ ...row, label: `${row.company || "Unknown"} — ${row.role || "Role"}` });
    await loadEvidence(row.matched);
  }

  const tailored = resume?.tailored || [];

  return (
    <div className="space-y-8">
      <BaseResume ready={!!resume?.staticReady} onUploaded={load} />

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => void load()} disabled={status === "loading"}>
          {status === "loading" ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {status === "missing" || status === "error" ? (
        <Notice tone="bad">
          <p>
            <strong>Could not load resume state.</strong> {message}
          </p>
        </Notice>
      ) : null}

      {selected ? (
        <Card className="gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                Keyword detail
              </p>
              <h3 className="mt-1 text-base font-semibold">{selected.label}</h3>
            </div>
            <div className="flex items-start gap-3">
              <p
                className={cn(
                  "text-3xl font-semibold tabular-nums",
                  scoreTone(selected.score) === "good" && "text-[var(--ok)]",
                  scoreTone(selected.score) === "fair" && "text-[var(--warn)]",
                  scoreTone(selected.score) === "weak" && "text-destructive"
                )}
              >
                {selected.score ?? "—"}
                <span className="text-muted-foreground ml-1 text-xs font-medium">match</span>
              </p>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MatchedKeywords words={selected.matched} evidence={evidence} />
            <KeywordGroup title="Missing" words={selected.missing} tone="weak" />
          </div>
          {selected.jobUrl ? (
            <a href={selected.jobUrl} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}>
              Open posting
            </a>
          ) : null}
        </Card>
      ) : null}

      <details className="rounded-xl border p-5">
        <summary className="cursor-pointer font-medium">Match insights</summary>
        <div className="mt-4">
          <section className="grid gap-3 lg:grid-cols-2">
            <HorizontalBars
              icon={Gauge}
              title="Match scores"
              description="Every job on record, best match first"
              data={resumeScores(tailored)}
              dataKey="score"
              fill="var(--chart-2)"
              emptyNote="No jobs on record yet."
            />
            <VerticalBars
              icon={Layers}
              title="Keyword coverage"
              description="Matched against missing, per job"
              data={keywordCoverage(tailored)}
              series={[
                { dataKey: "matched", fill: "var(--ok)" },
                { dataKey: "missing", fill: "var(--destructive)" }
              ]}
              stacked
              emptyNote="Nothing on record yet, so there is no coverage to compare."
            />
            <HorizontalBars
              icon={TriangleAlert}
              title="Most frequent gaps"
              description="Keywords missing across jobs"
              data={topMissingKeywords(tailored)}
              dataKey="jobs"
              fill="var(--destructive)"
              emptyNote="No gaps recorded yet."
              footer="Counted across every job on record. These are the skills costing you matches most often."
            />
          </section>
        </div>
      </details>

      <section>
        <SectionHead icon={FileText} title="Resume matches" note="Keyword coverage recorded for each job, with its score and remaining gaps." />
        {status === "loading" ? (
          <EmptyState title="Loading…" note="Reading local resume data." />
        ) : tailored.length === 0 ? (
          <EmptyState title="No resume matches yet" note="Entries are read from data/tailored.json." />
        ) : (
          <DataList>
            {tailored.map((row) => (
              <DataRow key={`${row.company}-${row.jobUrl}-${row.generatedAt}`}>
                <div className="font-medium">
                  {row.jobUrl ? (
                    <a href={row.jobUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {row.company || "—"}
                    </a>
                  ) : (
                    row.company || "—"
                  )}
                </div>
                <div className="text-muted-foreground truncate text-sm">{row.role || "—"}</div>
                <div>
                  <StatusPill
                    tone={
                      scoreTone(row.score) === "good"
                        ? "submitted"
                        : scoreTone(row.score) === "fair"
                          ? "waiting"
                          : "rejected"
                    }
                  >
                    {row.score ?? "—"} match
                  </StatusPill>
                </div>
                <div className="text-muted-foreground truncate text-sm">
                  {(row.missing || []).length
                    ? `Missing: ${(row.missing || []).slice(0, 4).join(", ")}${
                        (row.missing || []).length > 4 ? ` +${(row.missing || []).length - 4}` : ""
                      }`
                    : "No gaps flagged"}
                </div>
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                  <Button size="sm" variant="outline" onClick={() => void inspect(row)}>
                    Details
                  </Button>
                </div>
                <div className="text-muted-foreground text-xs">{formatDay(row.generatedAt)}</div>
              </DataRow>
            ))}
          </DataList>
        )}
      </section>
    </div>
  );
}

function KeywordGroup({
  title,
  words,
  tone
}: {
  title: string;
  words?: string[];
  tone: "weak" | "muted";
}) {
  const list = words || [];
  return (
    <div className="bg-muted rounded-lg p-3">
      <h4 className={cn("mb-2 text-sm font-semibold", tone === "weak" ? "text-destructive" : "text-muted-foreground")}>
        {title} {list.length ? <span className="text-muted-foreground text-xs">{list.length}</span> : null}
      </h4>
      {list.length === 0 ? (
        <p className="text-muted-foreground text-xs">None</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((word) => (
            <li
              key={word}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs",
                tone === "weak"
                  ? "border-[color-mix(in_oklab,var(--destructive)_26%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)]"
                  : "bg-background"
              )}
            >
              {word}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Matched keywords, annotated with what actually backs them — or nothing. */
function MatchedKeywords({
  words,
  evidence
}: {
  words?: string[];
  evidence: Map<string, EvidenceHit> | null;
}) {
  const list = words || [];
  return (
    <div className="bg-muted rounded-lg p-3">
      <h4 className="mb-2 text-sm font-semibold text-[var(--ok)]">
        Matched {list.length ? <span className="text-muted-foreground text-xs">{list.length}</span> : null}
      </h4>
      {list.length === 0 ? (
        <p className="text-muted-foreground text-xs">None</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((word) => {
            const hit = evidence?.get(word);
            if (!evidence) {
              return (
                <li key={word} className="bg-background rounded-full border px-2 py-0.5 text-xs">
                  {word}
                </li>
              );
            }
            if (!hit || !hit.total) {
              return (
                <li
                  key={word}
                  title="No related context found in your database"
                  className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border border-dashed px-2 py-0.5 text-xs"
                >
                  {word}
                  <span className="text-[10px] font-semibold opacity-80">no evidence</span>
                </li>
              );
            }
            const where = hit.sample
              .map((row) => row.provenance?.file || row.kind || "")
              .filter(Boolean)
              .join(", ");
            return (
              <li
                key={word}
                title={`${hit.verified} verified · ${hit.total - hit.verified} stated${where ? ` · ${where}` : ""}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
                  hit.verified
                    ? "border-[color-mix(in_oklab,var(--ok)_28%,transparent)] bg-[color-mix(in_oklab,var(--ok)_14%,transparent)]"
                    : "border-[color-mix(in_oklab,var(--warn)_28%,transparent)] bg-[color-mix(in_oklab,var(--warn)_14%,transparent)]"
                )}
              >
                {word}
                <span className="text-[10px] font-semibold opacity-80">
                  {hit.verified ? `${hit.verified} file/git facts` : `${hit.total} document claims`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-muted-foreground mt-2 text-xs">
        {evidence
          ? 'These are related keyword matches, not verification of a resume claim. A dependency or commit does not prove personal ownership or a business result.'
          : "Connect sources on the Evidence tab to see which of these are backed by real evidence."}
      </p>
    </div>
  );
}

function BaseResume({ ready, onUploaded }: { ready: boolean; onUploaded: () => Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function upload(file?: File) {
    if (!file || isPreview()) return;
    setUploading(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch("/api/resume/upload", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
      const data = await response.json().catch(() => ({ error: "The upload service is unavailable. Refresh the page and try again." }));
      if (!response.ok || data.error) throw Error(data.error || "Upload failed");
      setMessage(data.message || "Resume uploaded.");
      await onUploaded();
    } catch (error) { setFailed(true); setMessage((error as Error).message); }
    finally { setUploading(false); }
  }
  return <Card className="gap-4 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">Your base resume</h3><p className="text-muted-foreground mt-1 text-sm">{ready ? "Your one-page PDF is ready to review." : "Add a one-page PDF to use as your base resume."}</p></div>
      {ready ? <a href="/resumes/RESUME.pdf" target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>Open base PDF</a> : null}
    </div>
    <div className="grid gap-2"><Label htmlFor="base-resume-file">{uploading ? "Uploading…" : "Upload resume PDF"}</Label><Input id="base-resume-file" type="file" accept="application/pdf,.pdf" disabled={uploading || isPreview()} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></div>
    <p className="text-muted-foreground text-xs">The PDF is saved in data/resumes on this computer. A new upload replaces it.</p>
    {message ? <p role={failed ? "alert" : "status"} className={failed ? "text-destructive text-sm" : "text-sm text-[var(--ok)]"}>{message}</p> : null}
    <a href="#database" className="text-sm underline">Connect supporting evidence →</a>
  </Card>;
}
