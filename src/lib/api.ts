// Transport and shared types for the local Job Desk API.
import { isPreview } from "./preview";
import type { FlowData } from "./flow-model.mjs";

function requireLiveMode() {
  if (isPreview()) throw new Error("Design preview is read-only. Return to the live dashboard to make changes.");
}

export type Bucket = "submitted" | "waiting" | "blocked" | "rejected";

export interface Application {
  company: string;
  role: string;
  url: string;
  status: string;
  submitted_at?: string;
  salary?: number | string | null;
  live?: string | null;
  liveIndex?: number | null;
  liveTotal?: number | null;
}

export interface InboxRow {
  uid?: string;
  company?: string;
  role?: string;
  subject?: string;
  kind?: string;
  action?: string;
  at?: number | string;
  url?: string;
  link?: string;
}

export interface NeededRow {
  id: string;
  question?: string;
  note?: string;
  company?: string;
  url?: string;
}

export interface OutreachContact {
  full_name?: string;
  current_title?: string;
  linkedin_url?: string;
  connection_status?: string;
}

export interface OutreachRow {
  id: string;
  company: string;
  role: string;
  job_id: string;
  status: string;
  strategy?: string;
  notes?: string;
  relevance_score?: number | null;
  relevance_reasons?: string[];
  contact?: OutreachContact;
  generated_message?: string;
  final_message?: string;
  followUpDraft?: string;
  resumeReply?: string;
  resume?: { href?: string };
  quality?: { verdict?: string; reasons?: string[] };
  history?: { status?: string; company?: string; job?: string; at?: string }[];
  search_plan?: { kind?: string; url?: string }[];
}

export interface OutreachCompany {
  company: string;
  jobs: unknown[];
  sent: number;
  cap: number;
  recruiters: number;
  employees: number;
  replies: number;
  remaining: number;
  connected: number;
  connectionsRequested: number;
  contacts: { name: string; strategy?: string; status: string }[];
}

export interface OutreachStats {
  needsReview?: number;
  needsContact?: number;
  approved?: number;
  sent?: number;
  replies?: number;
  positive?: number;
  referrals?: number;
  responseRate?: number;
  referralRate?: number;
  smallSample?: boolean;
  complete?: boolean;
  experiment?: { id?: number; name?: string; target?: number };
  byStrategy?: Record<string, { messages: number; replies: number; referrals: number }>;
}

export interface OutreachState {
  stats?: OutreachStats;
  rows?: OutreachRow[];
  ranked?: { company: string; role: string; url: string; tier?: string; submitted_at?: string }[];
  companies?: OutreachCompany[];
  dueFollowUps?: { id: string; company: string; role: string }[];
}

export interface TrackerState {
  flow?: FlowData;
  generatedAt: string;
  agent: string;
  agentLabel: string;
  agentDetail?: string;
  counts: Record<string, number>;
  inbox?: { rejections?: InboxRow[]; actions?: InboxRow[]; codes?: unknown[] };
  needed?: NeededRow[];
  applications?: Application[];
  outreach?: OutreachState | null;
  setup?: { complete: boolean; missing: string[]; outreachError: string | null } | null;
}

export interface TailoredResume {
  company?: string;
  role?: string;
  jobUrl?: string;
  pdfPath?: string;
  score?: number;
  matched?: string[];
  missing?: string[];
  generatedAt?: string;
}

export interface ResumeState {
  available?: boolean;
  hasContent?: boolean;
  staticReady?: boolean;
  tailoringEnabled?: boolean;
  sourceCount?: number;
  docsCount?: number;
  sourceErrors?: { name: string; error: string }[];
  tailored?: TailoredResume[];
  error?: string;
}

export interface TailorResult {
  path?: string | null;
  tailored?: boolean;
  reason?: string;
  quality?: { rule: string; message: string; where?: string }[];
  score?: number;
  matched?: string[];
  missing?: string[];
  dropped?: (string | { text: string; reason: string })[];
  suggested?: {
    id: string;
    answersKeyword: string;
    evidence: Evidence;
    note: string;
  }[];
  evidence?: {
    id: string;
    text: string;
    citations: Evidence[];
    relatedContext: Evidence[];
  }[];
}

export interface CorpusSource {
  name: string;
  kind: string;
  path: string;
  evidenceCount?: number;
  lastScanned?: string | null;
  error?: string | null;
}

export interface Evidence {
  id: string;
  kind?: string;
  text?: string;
  /** The exact snippet the fact was read from, when there is one. */
  verbatim?: string | boolean;
  sourceName?: string;
  sourceKind?: string;
  provenance?: { file?: string; line?: number | null; commit?: string | null; date?: string | null };
  tags?: string[];
  metrics?: Record<string, unknown>;
  dateRange?: { start?: string; end?: string };
  score?: number;
  matched?: string[];
  confidence?: "verified" | "stated";
}

export interface FacetBucket {
  name: string;
  count: number;
}

/** Pre-counted facets for the evidence browser filters. */
export interface CorpusFacets {
  available?: boolean;
  error?: string;
  total?: number;
  sources?: FacetBucket[];
  kinds?: FacetBucket[];
  tags?: FacetBucket[];
  confidence?: FacetBucket[];
}

export interface CorpusState {
  available?: boolean;
  error?: string;
  sources?: CorpusSource[];
  totals?: {
    sources?: number;
    evidence?: number;
    byKind?: Record<string, number>;
    byConfidence?: Record<string, number>;
  };
  lastScanned?: string | null;
}

/** A route that exists but is not installed, or does not exist at all. */
export class NotBuiltError extends Error {
  readonly notBuilt = true;
  constructor(message: string) {
    super(message || "Not available yet");
    this.name = "NotBuiltError";
  }
}

const NOT_BUILT = new Set([404, 501, 503]);

async function unwrap<T>(res: Response, path: string): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (NOT_BUILT.has(res.status)) throw new NotBuiltError(data?.error || `${path} is not available yet`);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export async function getState(): Promise<TrackerState> {
  const res = await fetch("/api/state", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as TrackerState;
}

export async function postJson<T = unknown>(path: string, body?: unknown): Promise<T> {
  requireLiveMode();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
  return data;
}

export async function getOptional<T>(path: string, timeout = 20000): Promise<T> {
  const res = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(timeout) });
  return unwrap<T>(res, path);
}

export async function postOptional<T>(path: string, body?: unknown, timeout = 120000): Promise<T> {
  requireLiveMode();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeout)
  });
  return unwrap<T>(res, path);
}

export async function deleteOptional<T>(path: string): Promise<T> {
  requireLiveMode();
  const res = await fetch(path, { method: "DELETE", signal: AbortSignal.timeout(20000) });
  return unwrap<T>(res, path);
}
