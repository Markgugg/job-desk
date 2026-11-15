import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getOptional, postOptional } from "@/lib/api";

const SCORE_BANDS = [
  { min: 85, range: "85–100", label: "Strong", color: "text-emerald-700 dark:text-emerald-400" },
  { min: 75, range: "75–84", label: "Good", color: "text-lime-700 dark:text-lime-300" },
  { min: 50, range: "50–74", label: "Partial", color: "text-orange-700 dark:text-orange-400" },
  { min: 0, range: "0–49", label: "Weak", color: "text-red-700 dark:text-red-400" },
];

function MatchScore({ score }: { score: number | null }) {
  const band = score === null ? null : SCORE_BANDS.find(b => score >= b.min);
  return <span
    className={`whitespace-nowrap font-semibold tabular-nums ${band?.color || "text-muted-foreground"}`}
    aria-label={band ? `${score} out of 100, ${band.label.toLowerCase()} match` : "Unscored"}
    title={band ? `${band.label} match · ${band.range}` : "Not enough verified information to score"}
  >{score === null ? "Unscored" : `${score}/100`}</span>;
}

type Match = { key: string; url: string; company: string; role: string; location: string; score: number | null; status: string; confidence: string; checkedAt: string; stale: boolean; locationConfirmed?: boolean; tracked: boolean; blockers: string[]; unknowns: string[]; matchedSkills: string[]; missingSkills: string[]; apiUrl?: string;
  dimensions?: { name: string; points: number; max: number; reason: string }[];
  requirements?: { requirement: string; importance: string; match: string; quote: string; evidence: string }[] };
type MatchState = { discovery?: { sources: { status: string }[]; listings?: { sources?: { url: string; status: string; error?: string }[] } }; updatedAt: string | null; profileChanged: boolean; jobs: Match[]; counts: Record<string, number>; sources: { board: string; ats: string; status: string; error?: string; count: number; apiUrl: string }[] };

export function JobMatches({ preview, onTracked }: { preview: boolean; onTracked: () => Promise<void> }) {
  const detailPanel = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<MatchState | null>(null);
  const [minimum, setMinimum] = useState(75);
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("eligible"), [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Match | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  useEffect(() => { if (detail) detailPanel.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [detail]);
  async function refresh() { if (preview) return; try { setData(await getOptional<MatchState>("/api/jobs")); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { void refresh(); }, [preview]);
  useEffect(() => { setPage(0); }, [search, filter, minimum]);
  const eligible = (j: Match) => j.status === "live" && !j.stale && !j.tracked && !j.blockers.length && j.score !== null && j.score >= minimum;
  const visible = (data?.jobs || []).filter(j => `${j.company} ${j.role} ${j.location}`.toLowerCase().includes(search.toLowerCase()) && (filter === "all" || filter === "eligible" && eligible(j) || filter === "blocked" && j.blockers.length > 0 || filter === "unverified" && j.status !== "live"));
  async function inspect(j: Match) { setError(""); try { setDetail(await getOptional<Match>(`/api/jobs?key=${encodeURIComponent(j.key)}`)); } catch(e) {setError((e as Error).message);} }
  async function track(j: Match) {
    setBusy(j.key); setError("");
    try { await postOptional("/api/jobs/track", { key: j.key }); toast.success(`Tracking ${j.company}`, { description: "It is in Applications as ready to submit." }); await refresh(); await onTracked(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  return <Card className="gap-5 p-5">
    <div><h3 className="font-semibold">Matched postings</h3><p className="text-muted-foreground mt-1 text-sm">Postings scored against your profile and evidence. Inspect a score, then track the ones worth applying to.</p></div>
    <p className="text-muted-foreground text-sm">{data?.updatedAt ? `${data.counts.total.toLocaleString()} postings · ${data.counts.live} live · ${data.counts.closed} closed · ${data.counts.unverified} unverified · Updated ${new Date(data.updatedAt).toLocaleString()}` : "No postings loaded. Postings are read from data/jobs.json."}</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-2 text-sm font-medium" htmlFor="match-minimum">Minimum score / 100<Input id="match-minimum" className="w-32" type="number" min={0} max={100} value={minimum} onChange={e => setMinimum(Number(e.target.value))} /></label>
      <Input aria-label="Search matched jobs" className="max-w-md" placeholder="Search company, role, or location…" value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Filter matched jobs" className="bg-background h-9 rounded-md border px-2 text-sm" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All postings</option><option value="eligible">Meets my cutoff</option><option value="blocked">Known fit blockers</option><option value="unverified">Closed / unverified</option></select>
    </div>
    {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Match score color guide">
      {SCORE_BANDS.map(band => <span key={band.min} className={`font-medium ${band.color}`}>{band.range} · {band.label}</span>)}
      <span className="text-muted-foreground">Fit score; blockers still apply.</span>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Match</th><th className="p-2">Role</th><th className="p-2">Location</th><th className="p-2">Review</th></tr></thead><tbody>{visible.slice(page * 15, (page + 1) * 15).map(j => <tr key={j.key} className="border-b align-top"><td className="p-2 font-medium"><MatchScore score={j.score} /><span className="text-muted-foreground mt-1 block text-xs">{j.stale ? "Refresh needed" : j.confidence}</span></td><td className="p-2"><a className="underline" href={j.url} target="_blank" rel="noreferrer">{j.company} · {j.role}</a><span className="text-muted-foreground mt-1 block text-xs">{j.tracked ? "Already tracked" : j.status}{j.blockers.length ? ` · ${j.blockers[0]}` : j.unknowns.length ? ` · ${j.unknowns[0]}` : ""}</span></td><td className="p-2">{j.location || "Unknown"}</td><td className="p-2"><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void inspect(j)}>Why this score?</Button><Button size="sm" disabled={preview || j.tracked || j.status !== "live" || busy === j.key} onClick={() => void track(j)}>{j.tracked ? "Tracked" : busy === j.key ? "Adding…" : "Track"}</Button></div></td></tr>)}</tbody></table>{!visible.length ? <p className="text-muted-foreground p-4 text-sm">No postings in this view.</p> : null}</div>
    <div className="flex items-center justify-between text-sm"><span>{visible.length} postings · Page {page + 1} of {Math.max(1, Math.ceil(visible.length / 15))}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={(page + 1) * 15 >= visible.length} onClick={() => setPage(page + 1)}>Next</Button></div></div>
    {detail ? <div ref={detailPanel} className="space-y-3 rounded-lg border p-4"><div className="flex items-start justify-between"><h4 className="font-medium">{detail.company} · {detail.role} <MatchScore score={detail.score} /></h4><Button size="sm" variant="ghost" onClick={() => setDetail(null)}>Close</Button></div><p className="text-muted-foreground text-xs">Posting checked {new Date(detail.checkedAt).toLocaleString()}.</p>
      {[...detail.blockers, ...detail.unknowns].map((reason, i) => <p key={i} className="text-sm">• {reason}</p>)}
      <div className="grid gap-2 sm:grid-cols-2">{detail.dimensions?.map(d => <div className="bg-muted rounded-md p-3 text-sm" key={d.name}><strong>{d.name}: {d.points}/{d.max}</strong><p className="text-muted-foreground mt-1 text-xs">{d.reason}</p></div>)}</div>
      <details><summary className="cursor-pointer text-sm font-medium">Requirements and saved evidence ({detail.requirements?.length || 0})</summary><div className="mt-3 space-y-3">{detail.requirements?.map((r,i) => <div key={i} className="border-t pt-3 text-sm"><p className="font-medium">{r.requirement} · {r.importance} · {r.match}</p><p className="text-muted-foreground mt-1">Posting: “{r.quote}”</p><p className="mt-1">{r.evidence}</p></div>)}</div></details>
    </div> : null}
    <details><summary className="cursor-pointer text-sm">How scoring works</summary><p className="text-muted-foreground mt-3 text-sm">Role alignment 15 + career stage 20 + skills evidence 40 + education/timing 15 + location preference 10. Scores rank documented fit; they are not hiring probabilities. Postings and scores are read from data/jobs.json, and the demo data ships with sample postings.</p></details>
  </Card>;
}
