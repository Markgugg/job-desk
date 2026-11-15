import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DataList,
  DataRow,
  EmptyState,
  ExternalLink,
  SectionHead,
  StatCard,
  StatusPill,
  toneForStatus
} from "@/components/bits";
import { HorizontalBars, OutcomesOverTime, PipelineRings, SubmittedOverTime } from "@/components/charts";
import {
  Building2,
  CheckCircle2,
  ClipboardList,
  HelpCircle,
  Inbox,
  MessageSquareWarning,
  Send,
  Search,
  ChevronLeft,
  ChevronRight,
  XCircle
} from "lucide-react";
import { postJson, type TrackerState } from "@/lib/api";
import {
  actionLabel,
  filterApplications,
  formatMailDate,
  formatSalary,
  plural,
  outcomesSeries,
  pipelineRings,
  statusLabel,
  submittedSeries,
  companyRemainder,
  topCompanies,
  uniqueActions,
  uniqueRejections,
  type Filter
} from "@/lib/format";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "submitted", label: "Submitted" },
  { key: "all", label: "All" },
  { key: "waiting", label: "Ready to submit" },
  { key: "blocked", label: "Blocked / skipped" },
  { key: "needs-you", label: "Needs you" },
  { key: "ask-me", label: "Ask me" },
  { key: "rejected", label: "Rejected" }
];

const PAGE_SIZE = 10;

export function ApplicationsPage({
  state,
  refresh,
  onOutreach
}: {
  state: TrackerState;
  refresh: () => void;
  onOutreach: (jobUrl: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [range, setRange] = useState<90 | 365 | 0>(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [askQ, setAskQ] = useState("");
  const [askA, setAskA] = useState("");

  const counts = state.counts || {};
  const withinRange = range
    ? (state.applications || []).filter((row) => {
        const day = String(row.submitted_at || "").slice(0, 10);
        if (!day) return false;
        const age = (Date.now() - new Date(`${day}T00:00:00`).getTime()) / 86400000;
        return age >= 0 && age <= range;
      })
    : state.applications;
  const rows = filterApplications(state.applications, filter)
    .filter((row) => `${row.company} ${row.role}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (b.submitted_at || "").localeCompare(a.submitted_at || ""));
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const actions = uniqueActions(state.inbox?.actions);
  const rejections = uniqueRejections(state.inbox?.rejections);
  const needed = Array.isArray(state.needed) ? state.needed : [];

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function chooseFilter(next: Filter) {
    setFilter(next);
    setPage(0);
    const jump: Partial<Record<Filter, string>> = {
      rejected: "rejections",
      "needs-you": "needs-you",
      "ask-me": "ask-me"
    };
    const id = jump[next];
    if (id) window.setTimeout(() => scrollTo(id), 0);
  }

  async function markSubmitted(url: string) {
    setBusy(prev=>new Set(prev).add(url));
    try {
      await postJson("/api/applications/mark-submitted", { url });
      toast.success("Marked as submitted");
    } catch (err) { toast.error("Status not changed", { description: String((err as Error).message || err) }); }
    finally {setBusy(prev=>{const next=new Set(prev);next.delete(url);return next;});refresh();}
  }

  async function dismissAction(uid: string) {
    try {
      await postJson("/api/dismiss-action", { uid });
      toast.success("Cleared from Needs you");
    } catch (err) {
      toast.error("Not cleared", { description: String((err as Error).message || err) });
    } finally {
      refresh();
    }
  }

  async function saveNeeded(id: string) {
    const answer = String(answers[id] || "").trim();
    if (!answer) {
      toast.error("Write an answer before saving");
      return;
    }
    try {
      await postJson("/api/needed-answer", { id, answer });
      setAnswers((prev) => ({ ...prev, [id]: "" }));
      toast.success("Answer saved");
    } catch (err) {
      toast.error("Answer not saved", { description: String((err as Error).message || err) });
    } finally {
      refresh();
    }
  }

  async function skipNeeded(id: string) {
    try {
      await postJson("/api/needed-dismiss", { id });
      toast.success("Question skipped");
    } catch (err) {
      toast.error("Question not skipped", { description: String((err as Error).message || err) });
    } finally {
      refresh();
    }
  }

  async function saveAsk(event: React.FormEvent) {
    event.preventDefault();
    const question = askQ.trim();
    const answer = askA.trim();
    if (!question || !answer) {
      toast.error("Fill in both the question and the answer");
      return;
    }
    try {
      await postJson("/api/needed-answer", { question, answer });
      setAskQ("");
      setAskA("");
      toast.success("Saved to your answer bank");
    } catch (err) {
      toast.error("Answer not saved", { description: String((err as Error).message || err) });
    } finally {
      refresh();
    }
  }

  const waiting = counts.waiting ?? 0;

  return (
    <div className="space-y-6">
      {!counts.total ? (
        <div className="bg-card flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5">
          <div><h3 className="font-semibold">{counts.queue ? `${Number(counts.queue).toLocaleString()} matched postings are waiting.` : "Track your first job"}</h3>
            <p className="text-muted-foreground mt-1 text-sm">Add a job on the Jobs tab, or track one of the matched postings there.</p></div>
          <a href="#automations" className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium">Open Jobs →</a>
        </div>
      ) : null}
      {/* Real counts only. No deltas: nothing stores a prior period to compare against. */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Pipeline totals">
        <StatCard
          icon={Send}
          label="Submitted"
          value={counts.submitted ?? 0}
          lead={`${plural(counts.total ?? 0, "application", "applications")} tracked`}
          note={`${plural(counts.queue ?? 0, "role", "roles")} in the queue`}
        />
        <StatCard
          icon={ClipboardList}
          label="Ready to submit"
          value={waiting}
          lead={waiting ? `${plural(waiting, "job is", "jobs are")} ready to send` : "Nothing waiting on you"}
          note={waiting ? "Mark each one once you submit it" : "Jobs you plan to apply to land here"}
        />
        <StatCard
          icon={MessageSquareWarning}
          label="Needs you"
          value={actions.length}
          lead={actions.length ? "Interviews, assessments and replies" : "Inbox is clear"}
          note="Employer messages that need an answer"
        />
        <StatCard
          icon={HelpCircle}
          label="Ask me"
          value={counts.askMe ?? 0}
          lead={counts.askMe ? `${plural(counts.askMe, "question", "questions")} unanswered` : "No open questions"}
          note="Answers you save go in your answer bank"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" aria-label="Application insights">
        <SubmittedOverTime
          data={submittedSeries(withinRange)}
          action={
            <div className="bg-muted/50 flex gap-1 rounded-lg border p-1" role="group" aria-label="Chart date range">
              {([
                [90, "3 months"],
                [365, "12 months"],
                [0, "All time"]
              ] as const).map(([value, label]) => (
                <Button
                  key={label}
                  size="sm"
                  variant="ghost"
                  className={`h-7 px-2 text-xs ${range === value ? "bg-background shadow-xs" : "text-muted-foreground"}`}
                  aria-pressed={range === value}
                  onClick={() => setRange(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          }
          footer={
            range
              ? `Showing the last ${range === 90 ? "90 days" : "12 months"} of ${(state.applications || []).length} tracked applications.`
              : undefined
          }
        />
        <PipelineRings data={pipelineRings(state.applications)} />
      </section>

      <section id="pipeline" aria-label="Application ledger">
        <SectionHead
          title="Application pipeline"
          note="Planned jobs stay separate from submitted ones. After you apply on the employer's site, click I submitted this."
        />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted/50 p-1" role="group" aria-label="Filter applications">
            {FILTERS.map((item) => (
              <Button key={item.key} size="sm" variant="ghost"
                className={filter === item.key ? "bg-background shadow-xs" : "text-muted-foreground"}
                aria-pressed={filter === item.key} onClick={() => chooseFilter(item.key)}>
                {item.label}
                {item.key === "blocked" || item.key === "rejected" ? (
                  <span className="rounded border px-1 text-[10px] tabular-nums">{counts[item.key] ?? 0}</span>
                ) : null}
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4" aria-hidden />
            <Input aria-label="Search applications" placeholder="Search company or role…" className="h-9 pl-9"
              value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState title={query ? "No matching applications" : !counts.total ? "No applications tracked yet" : "No applications with this status"}
            note={query ? "Try another company or role, or clear your search." : !counts.total ? "Add a job on the Jobs tab to start tracking it." : "Pick another filter above."}
            action={query ? <Button variant="outline" onClick={() => setQuery("")}>Clear search</Button> : !counts.total ? <a href="#automations" className="text-sm underline">Add a job →</a> : undefined} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Applications table">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>{["Company / role", "Status", "Salary", "Date", "Next step"].map((heading) => (
                    <th key={heading} scope="col" className="px-4 py-3 text-xs font-medium last:text-right">{heading}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((row) => {
                    const open = !["submitted", "rejected", "withdrawn", "interview", "offer"].includes(row.status);
                    return (
                      <tr key={row.url} className="transition-colors hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg border text-xs font-medium" aria-hidden>{(row.company || "?").slice(0, 2).toUpperCase()}</span>
                            <div className="min-w-0"><p className="font-medium"><ExternalLink href={row.url}>{row.company}</ExternalLink></p>
                              <p className="text-muted-foreground mt-0.5 max-w-[340px] truncate text-xs" title={row.role}>{row.role}</p></div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><StatusPill tone={toneForStatus(row.status, row.live)}>{statusLabel(row)}</StatusPill></td>
                        <td className="text-muted-foreground px-4 py-3 text-xs tabular-nums">{formatSalary(row.salary)}</td>
                        <td className="text-muted-foreground whitespace-nowrap px-4 py-3 text-xs tabular-nums">{row.submitted_at || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {open ? <Button size="sm" variant="outline" disabled={busy.has(row.url)} onClick={() => markSubmitted(row.url)}>{busy.has(row.url) ? "Saving…" : "I submitted this"}</Button>
                            : row.status === "submitted" ? <Button size="sm" variant="outline" onClick={() => onOutreach(row.url)}>Outreach</Button> : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <p className="text-muted-foreground text-xs" aria-live="polite">Showing {currentPage * PAGE_SIZE + 1}–{currentPage * PAGE_SIZE + shown.length} of {rows.length} applications</p>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground mr-2 text-xs">Page {currentPage + 1} of {pageCount}</span>
                <Button size="icon-sm" variant="outline" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button>
                <Button size="icon-sm" variant="outline" aria-label="Next page" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button>
              </div>
            </div>
          </div>
        )}
      </section>

      <details className="group rounded-xl border bg-card p-5">
        <summary className="cursor-pointer text-sm font-medium">More insights <span className="text-muted-foreground ml-2 font-normal">Outcomes and top companies</span></summary>
        <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <OutcomesOverTime data={outcomesSeries(withinRange, range ? rejections.filter((row) => { const age = (Date.now() - Number(row.at)) / 86400000; return age >= 0 && age <= range; }) : rejections)} />
        <HorizontalBars
          icon={Building2}
          title="Top companies"
          description="Applications per company"
          data={topCompanies(state.applications)}
          dataKey="applications"
          fill="var(--chart-3)"
          emptyNote="No applications tracked yet, so there is nothing to rank."
          footer={(() => {
            const rest = companyRemainder(state.applications);
            return rest.companies
              ? `Top 8 shown. ${rest.companies} more companies account for ${rest.applications} further applications.`
              : undefined;
          })()}
        />
        </div>
      </details>

      <section id="needs-you">
        <SectionHead
          icon={MessageSquareWarning}
          title="Needs you"
          note="Interviews, assessments and recruiter replies. Clear each one when it is handled."
        />
        {actions.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing needs you"
            note="Interviews and recruiter replies will appear here."
          />
        ) : (
          <DataList>
            {actions.map((row) => (
              <DataRow key={row.uid || `${row.company}-${row.kind}`}>
                <div className="font-medium">
                  <ExternalLink href={row.link || row.url}>{row.company || "Unknown"}</ExternalLink>
                </div>
                <div className="text-muted-foreground truncate text-sm">{row.role || "—"}</div>
                <div className="text-muted-foreground truncate text-sm">{row.subject || "—"}</div>
                <div>
                  <StatusPill tone="waiting">{actionLabel(row)}</StatusPill>
                </div>
                <div className="sm:justify-self-end">
                  <Button size="sm" variant="outline" onClick={() => dismissAction(String(row.uid || ""))}>
                    Done
                  </Button>
                </div>
                <div className="text-muted-foreground text-xs">{formatMailDate(row.at)}</div>
              </DataRow>
            ))}
          </DataList>
        )}
      </section>

      <section id="ask-me">
        <SectionHead
          icon={HelpCircle}
          title="Ask me"
          note="Questions application forms asked that your profile does not answer yet. Saved answers go in your answer bank."
        />
        {needed.length === 0 ? (
          <EmptyState
            title="No open questions"
            note="Add a question below whenever a form asks something new."
          />
        ) : (
          <DataList>
            {needed.map((row) => (
              <div key={row.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(110px,0.7fr)_minmax(200px,2fr)_minmax(180px,1.4fr)_auto] sm:items-center sm:gap-4">
                <div className="font-medium">
                  <ExternalLink href={row.url}>{row.company || "profile"}</ExternalLink>
                </div>
                <div>
                  <p className="text-sm">{row.question || "—"}</p>
                  {row.company === "profile" ? <p className="text-muted-foreground text-xs">General question, not tied to one application.</p> : row.note ? <p className="text-muted-foreground text-xs">{row.note}</p> : null}
                </div>
                <div>
                  <Label className="sr-only" htmlFor={`ans-${row.id}`}>
                    Answer for: {row.question}
                  </Label>
                  <Input
                    id={`ans-${row.id}`}
                    value={answers[row.id] || ""}
                    placeholder="Your answer"
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveNeeded(row.id);
                      }
                    }}
                  />
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => saveNeeded(row.id)}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => skipNeeded(row.id)}>
                    Skip
                  </Button>
                </div>
              </div>
            ))}
          </DataList>
        )}

        <form onSubmit={saveAsk} className="bg-card mt-3 grid gap-3 rounded-xl border p-5 shadow-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="ask-q">Form question</Label>
            <Input id="ask-q" value={askQ} onChange={(e) => setAskQ(e.target.value)} placeholder="Question a form asked" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ask-a">Your answer</Label>
            <Input id="ask-a" value={askA} onChange={(e) => setAskA(e.target.value)} placeholder="What to enter next time" />
          </div>
          <Button type="submit" variant="outline">
            Save answer
          </Button>
        </form>
      </section>

      <section id="rejections">
        <SectionHead icon={XCircle} title="Rejections" note="Employer replies that closed an application." />
        {rejections.length === 0 ? (
          <EmptyState icon={Inbox} title="No rejections" note="No employer has said no yet." />
        ) : (
          <DataList>
            {rejections.map((row) => (
              <DataRow key={row.uid || `${row.company}-${row.subject}`}>
                <div className="font-medium">
                  <ExternalLink href={row.url}>{row.company || "Unknown"}</ExternalLink>
                </div>
                <div className="text-muted-foreground truncate text-sm">{row.role || "—"}</div>
                <div className="text-muted-foreground truncate text-sm">{row.subject || "—"}</div>
                <div>
                  <StatusPill tone="rejected">Rejected</StatusPill>
                </div>
                <div />
                <div className="text-muted-foreground text-xs">{formatMailDate(row.at)}</div>
              </DataRow>
            ))}
          </DataList>
        )}
      </section>
    </div>
  );
}
