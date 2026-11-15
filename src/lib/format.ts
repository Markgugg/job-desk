// Pure helpers: bucketing, formatting, filtering. No DOM, no fetch.
import type { Application, Bucket, InboxRow, TailoredResume } from "./api";

const BUCKETS: Record<string, Bucket> = {
  submitted: "submitted",
  interview: "submitted",
  offer: "submitted",
  rejected: "rejected",
  filled_awaiting_submit: "waiting",
  filling: "waiting"
};

/** Which of the four pipeline groups a status belongs to. Unknown statuses count as blocked. */
export function bucket(status?: string): Bucket {
  return BUCKETS[status ?? ""] ?? "blocked";
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 0
});

export function formatSalary(n?: number | string | null): string {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? money.format(value) : "—";
}

const mailDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function formatMailDate(at?: number | string): string {
  const ms = Number(at);
  return ms > 0 ? mailDate.format(new Date(ms)) : "—";
}

export function formatClock(value?: string): string {
  const when = new Date(String(value));
  if (Number.isNaN(when.getTime())) return "—";
  return when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatWhen(value?: string | null): string {
  if (!value) return "never";
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return String(value);
  return when.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDay(value?: string): string {
  if (!value) return "—";
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return String(value);
  return when.toLocaleDateString([], { month: "short", day: "numeric" });
}

const squash = (value?: string) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function keepFirst<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyOf(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Inbox rows without exact duplicates, newest first. */
export function uniqueRows(rows?: InboxRow[]): InboxRow[] {
  const list = keepFirst(rows ?? [], (row) => String(row.uid ?? `${row.company}~${row.subject}~${row.at}`));
  return list.sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0));
}

/** One rejection per company and subject line. */
export function uniqueRejections(rows?: InboxRow[]): InboxRow[] {
  return keepFirst(
    uniqueRows(rows).filter((row) => squash(row.company) || squash(row.subject)),
    (row) => `${squash(row.company)}~${squash(row.subject).slice(0, 80)}`
  );
}

const ACTION_ORDER = ["offer", "interview", "assessment", "reply", "form"];

/** One open task per company and kind, most urgent kind first. */
export function uniqueActions(rows?: InboxRow[]): InboxRow[] {
  const rank = (row: InboxRow) => {
    const index = ACTION_ORDER.indexOf(row.kind ?? "");
    return index === -1 ? ACTION_ORDER.length : index;
  };
  const ordered = uniqueRows(rows).sort((a, b) => rank(a) - rank(b));
  return keepFirst(ordered, (row) => `${squash(row.company)}~${row.kind ?? ""}`);
}

const ACTION_LABELS: Record<string, string> = {
  offer: "Respond to offer",
  interview: "Book the interview",
  assessment: "Take the assessment",
  reply: "Answer the recruiter",
  form: "Complete their form"
};

export function actionLabel(row: InboxRow): string {
  return row.action || ACTION_LABELS[row.kind ?? ""] || "Follow up";
}

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  filled_awaiting_submit: "Ready to submit",
  interview: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  blocked_needs_input: "Blocked · needs input",
  skipped_location: "Skipped · location",
  needs_retry: "Needs another try"
};

export function statusLabel(row: Application): string {
  const status = String(row.status ?? "");
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
  const words = status.replaceAll("_", " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Unknown";
}

export type Filter = "submitted" | "all" | "waiting" | "blocked" | "needs-you" | "ask-me" | "rejected";

/** Rejected, Needs you and Ask me jump to their own sections, so the table shows everything. */
export function listFilterFor(filter: Filter): string {
  return ["rejected", "needs-you", "ask-me"].includes(filter) ? "all" : filter;
}

export function filterApplications(applications: Application[] | undefined, filter: Filter): Application[] {
  const wanted = listFilterFor(filter);
  const rows = (applications ?? []).filter((row) => wanted === "all" || bucket(row.status) === wanted);
  return rows.sort((a, b) => String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? "")));
}

/**
 * Tailored PDFs live in resumes/tailored/, so the subdirectory has to survive.
 * /api/resume/pdf is confined to the resumes directory server-side.
 */
export function resumePdfPath(path?: string): string {
  const raw = String(path || "")
    .trim()
    .replace(/\\/g, "/");
  if (!raw) return "";
  const marker = raw.lastIndexOf("resumes/");
  const rest = marker >= 0 ? raw.slice(marker + "resumes/".length) : raw;
  const clean = rest
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return clean ? `resumes/${clean}` : "";
}

export function resumeHref(path?: string | null): string {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//.test(raw)) return raw;
  const rel = resumePdfPath(raw);
  return rel ? `/api/resume/pdf?path=${encodeURIComponent(rel)}` : "";
}

export function scoreTone(score?: number | string | null): "good" | "fair" | "weak" | "unknown" {
  if (score === null || score === undefined || score === "") return "unknown";
  const n = Number(score);
  if (!Number.isFinite(n)) return "unknown";
  if (n >= 75) return "good";
  if (n >= 50) return "fair";
  return "weak";
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Match JD keywords against evidence rows. A keyword is backed only if a row mentions it. */
export interface EvidenceHit {
  total: number;
  verified: number;
  sample: { provenance?: { file?: string }; kind?: string }[];
}

export function indexEvidence(
  keywords: string[] | undefined,
  rows: { text?: string; tags?: string[]; confidence?: string; provenance?: { file?: string }; kind?: string }[] | undefined
): Map<string, EvidenceHit> {
  const list = Array.isArray(rows) ? rows : [];
  const map = new Map<string, EvidenceHit>();
  for (const keyword of Array.isArray(keywords) ? keywords : []) {
    const needle = String(keyword || "").toLowerCase().trim();
    if (!needle) continue;
    const hits = list.filter((row) =>
      `${row.text || ""} ${(row.tags || []).join(" ")}`.toLowerCase().includes(needle)
    );
    map.set(String(keyword), {
      total: hits.length,
      verified: hits.filter((h) => h.confidence === "verified").length,
      sample: hits.slice(0, 3)
    });
  }
  return map;
}

export type Bucketing = "day" | "week" | "month";

/**
 * Pick a bucket size from the span of the data. A day-by-day axis turns to
 * mush past a couple of months, so weeks and then months take over.
 */
export function bucketingFor(days: string[]): Bucketing {
  if (days.length < 2) return "day";
  const sorted = [...days].sort();
  const first = new Date(`${sorted[0]}T00:00:00`).getTime();
  const last = new Date(`${sorted[sorted.length - 1]}T00:00:00`).getTime();
  const span = (last - first) / 86400000;
  if (span <= 45) return "day";
  if (span <= 400) return "week";
  return "month";
}

/** The label a day rolls up into for a given bucketing. */
export function bucketKey(day: string, bucketing: Bucketing): string {
  if (bucketing === "month") return `${day.slice(0, 7)}-01`;
  if (bucketing === "week") {
    const date = new Date(`${day}T00:00:00`);
    const weekday = (date.getDay() + 6) % 7; // Monday-first
    date.setDate(date.getDate() - weekday);
    return date.toISOString().slice(0, 10);
  }
  return day;
}

export function bucketLabel(key: string, bucketing: Bucketing): string {
  const when = new Date(`${key}T00:00:00`);
  if (Number.isNaN(when.getTime())) return key;
  if (bucketing === "month") return when.toLocaleDateString([], { month: "short", year: "2-digit" });
  if (bucketing === "week") return `w/c ${when.toLocaleDateString([], { month: "short", day: "numeric" })}`;
  return when.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Applications submitted over time, bucketed by day, week or month depending
 * on how much history there is. `limit` caps the number of plotted buckets.
 */
export function submittedSeries(applications?: Application[], limit = 60) {
  const days: string[] = [];
  for (const row of Array.isArray(applications) ? applications : []) {
    const day = String(row.submitted_at || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (row.status !== "submitted") continue;
    days.push(day);
  }
  if (!days.length) return [];
  const bucketing = bucketingFor(days);
  const counts = new Map<string, number>();
  for (const day of days) {
    const key = bucketKey(day, bucketing);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([key, submitted]) => ({ date: key, label: bucketLabel(key, bucketing), submitted, bucketing }));
}

/** Pipeline split. Empty buckets are dropped, never padded to look fuller. */
export function statusBreakdown(applications?: Application[]) {
  const order: [Bucket, string][] = [
    ["submitted", "Submitted"],
    ["waiting", "Ready to submit"],
    ["blocked", "Blocked"],
    ["rejected", "Rejected"]
  ];
  const counts = new Map<Bucket, number>();
  for (const row of Array.isArray(applications) ? applications : []) {
    const key = bucket(row.status);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return order
    .filter(([key]) => counts.get(key))
    .map(([key, label], i) => ({
      key,
      label,
      value: counts.get(key) as number,
      fill: `var(--chart-${(i % 5) + 1})`
    }));
}

/** Outreach stages, in funnel order. Built only from stats the API reports. */
export function outreachFunnel(stats?: OutreachFunnelInput) {
  const s = stats || {};
  const stages: [string, number | undefined][] = [
    ["Needs review", s.needsReview],
    ["Approved", s.approved],
    ["Sent", s.sent],
    ["Replies", s.replies],
    ["Referrals", s.referrals]
  ];
  const known = stages.filter(([, v]) => Number.isFinite(Number(v)));
  if (!known.length || known.every(([, v]) => !Number(v))) return [];
  return known.map(([label, value], i) => ({
    label,
    value: Number(value) || 0,
    fill: `var(--chart-${(i % 5) + 1})`
  }));
}

export interface OutreachFunnelInput {
  needsReview?: number;
  approved?: number;
  sent?: number;
  replies?: number;
  referrals?: number;
}

/** Pipeline buckets as concentric rings: each ring is a share of the total. */
export function pipelineRings(applications?: Application[]) {
  const split = statusBreakdown(applications);
  const total = split.reduce((sum, row) => sum + row.value, 0);
  const color: Record<string, string> = {
    submitted: "var(--ok)",
    waiting: "var(--warn)",
    blocked: "var(--info)",
    rejected: "var(--destructive)"
  };
  return split.map((row) => ({
    label: row.label,
    value: row.value,
    maxValue: total || 1,
    color: color[row.key] || row.fill
  }));
}

/** Match score per tailored resume, best first. */
export function resumeScores(tailored?: TailoredResume[]) {
  return (Array.isArray(tailored) ? tailored : [])
    .filter((row) => Number.isFinite(Number(row.score)))
    .map((row) => ({
      name: [row.company, row.role].filter(Boolean).join(" · ") || "Untitled",
      score: Number(row.score),
      missing: Array.isArray(row.missing) ? row.missing.length : 0
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Chart series builders. Each one reads real API data and returns [] when there
// is nothing to show, so the chart can render an empty state instead of points.
// ---------------------------------------------------------------------------

/** Companies applied to, most first. */
export function topCompanies(applications?: Application[], limit = 8) {
  const counts = new Map<string, number>();
  for (const row of Array.isArray(applications) ? applications : []) {
    const name = String(row.company || "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, applications]) => ({ name, applications }));
}

/** What the top-N bar chart leaves out, for an honest footer line. */
export function companyRemainder(applications?: Application[], limit = 8) {
  const counts = new Map<string, number>();
  for (const row of Array.isArray(applications) ? applications : []) {
    const name = String(row.company || "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rest = ranked.slice(limit);
  return { companies: rest.length, applications: rest.reduce((sum, [, n]) => sum + n, 0) };
}

/** Submitted vs rejected over time, bucketed the same way. */
export function outcomesSeries(applications?: Application[], rejections?: InboxRow[], limit = 60) {
  const submitted = new Map<string, number>();
  const rejected = new Map<string, number>();
  for (const row of Array.isArray(applications) ? applications : []) {
    const day = String(row.submitted_at || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (row.status === "submitted") submitted.set(day, (submitted.get(day) || 0) + 1);
  }
  for (const row of uniqueRejections(rejections)) {
    const at = Number(row.at);
    if (!at) continue;
    const day = new Date(at).toISOString().slice(0, 10);
    rejected.set(day, (rejected.get(day) || 0) + 1);
  }
  const allDays = [...new Set([...submitted.keys(), ...rejected.keys()])].sort();
  if (!allDays.length) return [];
  const bucketing = bucketingFor(allDays);
  const rolled = new Map<string, { submitted: number; rejected: number }>();
  for (const day of allDays) {
    const key = bucketKey(day, bucketing);
    const row = rolled.get(key) || { submitted: 0, rejected: 0 };
    row.submitted += submitted.get(day) || 0;
    row.rejected += rejected.get(day) || 0;
    rolled.set(key, row);
  }
  return [...rolled.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([key, row]) => ({
      date: key,
      label: bucketLabel(key, bucketing),
      submitted: row.submitted,
      rejected: row.rejected,
      bucketing
    }));
}

/** The real outreach status ladder, counted from the rows themselves. */
const OUTREACH_LADDER: [string, string][] = [
  ["NEEDS_CONTACT", "Needs contact"],
  ["DRAFTED", "Drafted"],
  ["NEEDS_REVIEW", "Needs review"],
  ["APPROVED", "Approved"],
  ["SENT", "Sent"],
  ["REPLIED", "Replied"],
  ["REFERRAL_OFFERED", "Referral offered"],
  ["REFERRAL_RECEIVED", "Referral received"]
];

export function outreachLadder(rows?: { status?: string }[]) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const counts = new Map<string, number>();
  for (const row of list) {
    const status = String(row.status || "").toUpperCase();
    counts.set(status, (counts.get(status) || 0) + 1);
    if (status === "POSITIVE_REPLY") counts.set("REPLIED", (counts.get("REPLIED") || 0) + 1);
  }
  const stages = OUTREACH_LADDER.filter(([key]) => counts.get(key)).map(([key, label], i) => ({
    key,
    label,
    value: counts.get(key) as number,
    color: `var(--chart-${(i % 5) + 1})`
  }));
  return stages;
}

/** Contact mix, read from the strategy and the contact's own title. */
export function contactsByType(rows?: { strategy?: string; contact?: { current_title?: string } }[]) {
  const list = Array.isArray(rows) ? rows : [];
  const buckets: Record<string, number> = { Recruiter: 0, Alumni: 0, Engineer: 0, Manager: 0, Other: 0 };
  let seen = 0;
  for (const row of list) {
    const title = String(row.contact?.current_title || "");
    if (!title && !row.strategy) continue;
    seen += 1;
    const haystack = `${row.strategy || ""} ${title}`.toUpperCase();
    if (/RECRUIT|TALENT|SOURCER/.test(haystack)) buckets.Recruiter += 1;
    else if (/ALUM|ALUMNI|UNIVERSITY|SCHOOL/.test(haystack)) buckets.Alumni += 1;
    else if (/MANAGER|DIRECTOR|HEAD OF|VP|LEAD/.test(haystack)) buckets.Manager += 1;
    else if (/ENGINEER|SWE|DEVELOPER|SOFTWARE/.test(haystack)) buckets.Engineer += 1;
    else buckets.Other += 1;
  }
  if (!seen) return [];
  return Object.entries(buckets)
    .filter(([, value]) => value > 0)
    .map(([name, contacts], i) => ({ name, contacts, fill: `var(--chart-${(i % 5) + 1})` }));
}

export interface StrategyRates {
  rows: { name: string; replyRate: number; messages: number }[];
  messages: number;
  enough: boolean;
}

/**
 * Reply rate per strategy. Below MIN_VOLUME messages a rate is noise, so the
 * caller is told to say so rather than plot n=1.
 */
export const MIN_STRATEGY_VOLUME = 5;

export function replyRateByStrategy(
  byStrategy?: Record<string, { messages: number; replies: number; referrals: number }>
): StrategyRates {
  const entries = Object.entries(byStrategy || {}).filter(([, v]) => Number(v?.messages) > 0);
  const messages = entries.reduce((sum, [, v]) => sum + Number(v.messages || 0), 0);
  const rows = entries.map(([key, v], i) => ({
    name: key.replaceAll("_", " ").toLowerCase(),
    messages: Number(v.messages || 0),
    replyRate: Math.round((Number(v.replies || 0) / Math.max(1, Number(v.messages || 0))) * 100),
    fill: `var(--chart-${(i % 5) + 1})`
  }));
  return { rows, messages, enough: messages >= MIN_STRATEGY_VOLUME };
}

/** Matched vs missing keyword counts per tailored resume. */
export function keywordCoverage(tailored?: TailoredResume[], limit = 8) {
  return (Array.isArray(tailored) ? tailored : [])
    .filter((row) => (row.matched?.length || 0) + (row.missing?.length || 0) > 0)
    .map((row) => ({
      name: [row.company, row.role].filter(Boolean).join(" · ") || "Untitled",
      matched: row.matched?.length || 0,
      missing: row.missing?.length || 0
    }))
    .sort((a, b) => b.matched + b.missing - (a.matched + a.missing))
    .slice(0, limit);
}

/** Keywords missing most often across every tailored resume — the real gaps. */
export function topMissingKeywords(tailored?: TailoredResume[], limit = 10) {
  const counts = new Map<string, number>();
  for (const row of Array.isArray(tailored) ? tailored : []) {
    for (const word of row.missing || []) {
      const key = String(word || "").trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, jobs]) => ({ name, jobs }));
}

/** Evidence counts by kind, straight from totals.byKind. */
export function evidenceByKind(byKind?: Record<string, number>) {
  return Object.entries(byKind || {})
    .filter(([, v]) => Number(v) > 0)
    .map(([kind, evidence], i) => ({
      name: ({ repo: "From code", docs: "From notes" } as Record<string, string>)[kind] || kind,
      evidence: Number(evidence),
      fill: `var(--chart-${(i % 5) + 1})`
    }));
}

/** Verified vs stated, straight from totals.byConfidence. */
export function evidenceByConfidence(byConfidence?: Record<string, number>) {
  const verified = Number(byConfidence?.verified || 0);
  const stated = Number(byConfidence?.stated || 0);
  if (!verified && !stated) return [];
  const total = verified + stated;
  return [
    { label: "Verified", value: verified, maxValue: total, color: "var(--ok)" },
    { label: "Stated", value: stated, maxValue: total, color: "var(--warn)" }
  ];
}

export function evidencePerSource(sources?: { name: string; evidenceCount?: number }[], limit = 10) {
  const ranked = (Array.isArray(sources) ? sources : [])
    .filter((s) => Number(s.evidenceCount) > 0)
    .map((s) => ({ name: s.name, evidence: Number(s.evidenceCount) }))
    .sort((a, b) => b.evidence - a.evidence);
  return ranked.slice(0, limit);
}

/** Sources not shown in the top-N evidence chart. */
export function sourceRemainder(sources?: { name: string; evidenceCount?: number }[], limit = 10) {
  const ranked = (Array.isArray(sources) ? sources : [])
    .filter((s) => Number(s.evidenceCount) > 0)
    .sort((a, b) => Number(b.evidenceCount) - Number(a.evidenceCount));
  const rest = ranked.slice(limit);
  return { sources: rest.length, evidence: rest.reduce((sum, r) => sum + Number(r.evidenceCount || 0), 0) };
}
