import { useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, GitBranch, Info, MousePointer2, RotateCcw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/bits";
import { FlowDiagram } from "@/components/flow-diagram";
import type { SectionKey } from "@/components/shell";
import type { TrackerState } from "@/lib/api";
import { buildFlowData } from "@/lib/flow-model.mjs";
import { formatClock } from "@/lib/format";
import { isPreview } from "@/lib/preview";

export function FlowPage({ state, offline, onNavigate }: {
  state: TrackerState;
  offline: boolean;
  onNavigate: (section: SectionKey) => void;
}) {
  const [mode, setMode] = useState<"applications" | "outreach">("applications");
  const [selected, setSelected] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const data = useMemo(() => state.flow ?? buildFlowData({
    applications: state.applications,
    inbox: state.inbox,
    outreach: state.outreach?.rows
  }), [state]);
  const graph = data[mode];
  const selection = graph.nodes.find((node) => node.id === selected) ?? graph.nodes.find((node) => node.id === "root");
  const groups = graph.nodes.filter((node) => node.column === 1);
  const metricColumns = groups.length === 3 ? "sm:grid-cols-4" : groups.length === 2 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  const preview = isPreview();
  const sourceAvailable = mode === "applications" || state.flow != null || state.outreach != null;
  const fresh = !offline && Date.now() - Date.parse(state.generatedAt) < 15000;
  const fraction = selection && graph.total ? selection.value / graph.total * 100 : 0;

  function changeMode(value: typeof mode) {
    setMode(value);
    setSelected(null);
  }

  function exportDiagram() {
    if (!svgRef.current) return;
    const svg = svgRef.current.cloneNode(true) as SVGSVGElement;
    const theme = getComputedStyle(document.documentElement);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "1120");
    svg.setAttribute("height", String(svgRef.current.viewBox.baseVal.height));
    svg.setAttribute("style", ["card", "foreground", "muted-foreground", "border"].map((key) => `--${key}:${theme.getPropertyValue(`--${key}`)}`).join(";"));
    svg.querySelectorAll<SVGElement>("[role=button]").forEach((element) => {
      element.style.opacity = "1";
      element.removeAttribute("tabindex");
      element.removeAttribute("role");
      element.removeAttribute("aria-pressed");
    });
    const title = svg.querySelector("title");
    if (title) title.textContent = `${preview ? "SAMPLE DATA · " : ""}${mode} flow · ${graph.total} ${graph.unit} · ${state.generatedAt}`;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `job-desk-${mode}-flow${preview ? "-sample" : ""}.svg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="bg-muted/50 inline-flex rounded-lg border p-1" role="group" aria-label="Flow view">
          <Button variant="ghost" aria-pressed={mode === "applications"} onClick={() => changeMode("applications")}
            className={mode === "applications" ? "bg-background shadow-xs" : "text-muted-foreground"}>
            <GitBranch className="size-4" />Applications
          </Button>
          <Button variant="ghost" aria-pressed={mode === "outreach"} onClick={() => changeMode("outreach")}
            className={mode === "outreach" ? "bg-background shadow-xs" : "text-muted-foreground"}>
            <Users className="size-4" />Outreach
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs">All records · current status</span>
          <Button variant="outline" onClick={exportDiagram} disabled={!graph.total}>
            <ArrowDownToLine className="size-4" />Export SVG
          </Button>
        </div>
      </div>

      {!state.flow ? (
        <p className="text-muted-foreground flex items-start gap-2 rounded-lg border px-4 py-3 text-xs">
          <Info className="size-4 shrink-0" />Using loaded records. Restart the tracker server to enable complete ledger snapshots, including older records and dismissed inbox tasks.
        </p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-xs" aria-label="Live Sankey diagram">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5 sm:px-7">
          <div>
            <div className="text-muted-foreground mb-2 flex items-center gap-2 text-[10px] font-medium tracking-[0.16em] uppercase">
              <GitBranch className="size-3.5" aria-hidden /> Pipeline intelligence
            </div>
            <h2 className="text-xl font-semibold tracking-tight">{mode === "applications" ? "The opportunity map" : "The relationship map"}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{mode === "applications" ? "From first application to the next conversation." : "From finding the right person to earning a referral."}</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs">
            <span className={`size-1.5 rounded-full ${fresh ? "bg-emerald-400" : "bg-amber-400"}`} />
            <span role="status">{preview ? "Sample snapshot" : fresh ? "Live snapshot" : "Last known snapshot"}</span>
            <span className="text-muted-foreground tabular-nums">{formatClock(state.generatedAt)}</span>
          </div>
        </div>

        {graph.total ? (
          <>
            <div className={`grid grid-cols-2 border-b ${metricColumns}`}>
              <div className="border-r p-5 sm:px-7">
                <p className="text-muted-foreground text-xs">{mode === "applications" ? "Tracked opportunities" : "Outreach records"}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{graph.total.toLocaleString()}</p>
                <p className="text-muted-foreground mt-1 text-xs">{state.flow ? "Complete ledger" : "Loaded records"}</p>
              </div>
              {groups.map((group) => (
                <button key={group.id} type="button" aria-pressed={selection?.id === group.id}
                  onClick={() => setSelected(selected === group.id ? null : group.id)}
                  className="border-r p-5 text-left transition-colors last:border-r-0 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring sm:px-7">
                  <p className="text-muted-foreground flex items-center gap-2 text-xs"><span className="size-1.5 rounded-full" style={{ background: group.color }} />{group.label}</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{group.value.toLocaleString()}</p>
                  <p className="text-muted-foreground mt-1 text-xs">{(group.value / graph.total * 100).toFixed(1)}% of total</p>
                </button>
              ))}
            </div>
            <p className="text-muted-foreground px-5 pt-4 text-xs sm:hidden">Swipe across the diagram to explore every stage.</p>
            <div className="overflow-x-auto px-2 py-5 sm:px-5" tabIndex={0} role="region" aria-label="Scrollable flow diagram">
              <FlowDiagram key={mode} graph={graph} selected={selection?.id ?? null} onSelect={setSelected} svgRef={svgRef} />
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-xs sm:px-7">
              <span className="flex items-center gap-2"><MousePointer2 className="size-3.5" />Select a band or stage to inspect its records</span>
              <span>Band width = record count · Updates every 5s</span>
            </div>
          </>
        ) : (
          <div className="p-5 sm:p-7">
            <EmptyState icon={GitBranch} className="min-h-72 justify-center shadow-none ring-0"
              title={!sourceAvailable ? "Outreach data is unavailable" : "Your flow starts with the first record"}
              note={!sourceAvailable ? "Complete your profile in Setup so outreach records can be loaded." : `Your ${mode === "applications" ? "applications" : "outreach records"} will appear here automatically. Every connection will reflect a real record.`}
              action={<Button variant="outline" onClick={() => onNavigate(!sourceAvailable ? "setup" : mode)}>{!sourceAvailable ? "Open setup" : `Open ${mode}`}<ArrowRight /></Button>} />
          </div>
        )}
      </section>

      {selection ? (
        <section className="grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[280px_1fr]" aria-label="Flow inspector">
          <div className="border-b p-5 lg:border-r lg:border-b-0 sm:p-6" aria-live="polite">
            <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
              <span>Selected stage</span>
              <Button size="icon-sm" variant="ghost" aria-label="Reset flow selection" disabled={selection.id === "root"} onClick={() => setSelected(null)}><RotateCcw className="size-3.5" /></Button>
            </div>
            <h3 className="mt-3 flex items-center gap-2 font-semibold"><span className="size-2 rounded-full" style={{ background: selection.color }} />{selection.label}</h3>
            <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">{selection.value.toLocaleString()}<span className="text-muted-foreground ml-2 text-sm font-normal">{graph.unit}</span></p>
            <div className="bg-muted mt-4 h-1 overflow-hidden rounded-full"><div className="h-full rounded-full transition-[width]" style={{ width: `${fraction}%`, background: selection.color }} /></div>
            <p className="text-muted-foreground mt-2 text-xs">{fraction.toFixed(1)}% of the {mode === "applications" ? "application" : "outreach"} pipeline</p>
          </div>
          <div className="min-w-0 p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Behind the numbers</h3>
              <span className="text-muted-foreground text-xs">{selection.records.length} of {selection.value} records</span>
            </div>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {selection.records.map((record, index) => (
                <div key={`${record.url}-${index}`} className="flex min-w-0 items-center gap-3">
                  <span className="text-muted-foreground bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-medium" aria-hidden>{record.company.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{record.company}</p><p className="text-muted-foreground truncate text-xs" title={record.role}>{record.role}</p></div>
                  {/^https?:\/\//i.test(record.url) ? (
                    <a href={record.url} target="_blank" rel="noreferrer" aria-label={`Open ${record.company}: ${record.role}`}
                      className="text-muted-foreground shrink-0 rounded-md p-2 transition-colors hover:bg-muted hover:text-foreground">
                      <ArrowUpRight className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
            <Button variant="link" className="mt-4 px-0 text-xs" onClick={() => onNavigate(mode)}>Open {mode}<ArrowRight className="size-3.5" /></Button>
          </div>
        </section>
      ) : null}

      <details className="text-muted-foreground px-1 text-xs">
        <summary className="w-fit cursor-pointer py-1">How this flow is counted</summary>
        <div className="mt-2 max-w-3xl space-y-2 leading-relaxed">
          <p>This is a current-state snapshot, not a history of stage changes. Every role or outreach record takes exactly one path. Different roles at the same company stay separate, and zero-count stages are hidden.</p>
          <p>Employer outcomes are linked by job URL, or an unambiguous company and role match. The latest eligible dated event is used. Company-only and unmatched emails never change a role’s outcome. {data.unmatchedInbox > 0 ? `${data.unmatchedInbox} inbox event${data.unmatchedInbox === 1 ? " is" : "s are"} not used because the match, timing, or application status is ineligible.` : ""}</p>
          <p>Outreach counts records, not unique people. Queue entries and profile questions are excluded because they can overlap with applications and do not represent additional roles.</p>
        </div>
      </details>
    </div>
  );
}
