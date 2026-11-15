/**
 * Design preview mode.
 *
 * Generates realistic-VOLUME sample data so the populated layout can be judged
 * before the agent has produced real records. Strict rules, do not weaken:
 *   1. It only turns on for an explicit `?preview=1` in the URL.
 *   2. While on, the UI shows a permanent high-contrast banner saying so.
 *   3. Nothing is persisted — no localStorage, no disk, no network write. The
 *      data lives in memory for the life of the tab and disappears with it.
 * Without the query parameter every screen reads the real API, empty or not.
 */
import type {
  Application,
  CorpusState,
  Evidence,
  InboxRow,
  OutreachRow,
  ResumeState,
  TrackerState
} from "./api";
import { buildFlowData } from "./flow-model.mjs";

export function isPreview(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("preview") === "1";
  } catch {
    return false;
  }
}

/** Deterministic PRNG so the sample set is stable between renders. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const COMPANIES = [
  "Acme Robotics", "Globex Analytics", "Initech Labs", "Bluefin Payments", "Lumen Health", "Orbital Freight",
  "Tidewater AI", "Copperline Software", "Redwood Games", "Quartz Security", "Harborview Fintech", "Meridian Maps",
  "Summit Learning", "Pinewood Media", "Saffron Retail", "Vantage Mobility", "Kestrel Energy", "Juniper Bio",
  "Nimbus Devices", "Arcadia Travel"
];

const ROLES = [
  "Software Engineer, New Grad", "Product Engineer", "Frontend Engineer", "Backend Engineer",
  "Full Stack Engineer", "Platform Engineer", "Data Engineer", "Infrastructure Engineer"
];

const KEYWORDS = [
  "typescript", "react", "node", "postgres", "graphql", "kubernetes", "terraform", "python",
  "go", "rust", "aws", "distributed systems", "ci/cd", "observability", "redis", "kafka",
  "grpc", "docker", "testing", "accessibility"
];

const STATUSES = [
  "submitted", "submitted", "submitted", "submitted", "submitted", "submitted",
  "filled_awaiting_submit", "blocked_needs_input", "skipped_location", "rejected", "needs_retry"
];

function isoDay(daysAgo: number): string {
  const when = new Date();
  when.setDate(when.getDate() - daysAgo);
  return when.toISOString().slice(0, 10);
}

function buildApplications(random: () => number, count = 264): Application[] {
  const rows: Application[] = [];
  for (let i = 0; i < count; i += 1) {
    const company = COMPANIES[Math.floor(random() * COMPANIES.length)];
    const role = ROLES[Math.floor(random() * ROLES.length)];
    const status = STATUSES[Math.floor(random() * STATUSES.length)];
    // Spread across roughly seven months of history.
    const daysAgo = Math.floor(random() * 210);
    rows.push({
      company,
      role,
      url: `https://jobs.example.com/${i}`,
      status,
      submitted_at: isoDay(daysAgo),
      salary: [130000, 145000, 160000, 175000, 190000][Math.floor(random() * 5)],
      live: null
    });
  }
  return rows;
}

function buildInbox(random: () => number, applications: Application[]) {
  const actions: InboxRow[] = [];
  const rejections: InboxRow[] = [];
  const kinds = ["interview", "assessment", "reply", "offer", "form"];
  for (let i = 0; i < 9; i += 1) {
    const app = applications[Math.floor(random() * applications.length)];
    actions.push({
      uid: `preview-action-${i}`,
      company: app.company,
      role: app.role,
      subject: ["Next steps", "Coding assessment", "Recruiter screen", "Team match call"][i % 4],
      kind: kinds[i % kinds.length],
      at: Date.now() - i * 7200000,
      url: app.url
    });
  }
  for (let i = 0; i < 38; i += 1) {
    const app = applications[Math.floor(random() * applications.length)];
    rejections.push({
      uid: `preview-rejection-${i}`,
      company: app.company,
      role: app.role,
      subject: "Update on your application",
      at: Date.now() - Math.floor(random() * 180) * 86400000,
      url: app.url
    });
  }
  return { actions, rejections, codes: [] };
}

function buildOutreach(random: () => number) {
  const ladder = [
    ["NEEDS_CONTACT", 22],
    ["DRAFTED", 14],
    ["NEEDS_REVIEW", 11],
    ["APPROVED", 9],
    ["SENT", 31],
    ["REPLIED", 12],
    ["REFERRAL_OFFERED", 6],
    ["REFERRAL_RECEIVED", 3]
  ] as const;
  const titles = [
    ["Technical Recruiter", "RECRUITER"],
    ["Software Engineer", "ENGINEER"],
    ["University alum, Senior SWE", "ALUMNI"],
    ["Engineering Manager", "MANAGER"]
  ];
  const rows: OutreachRow[] = [];
  let n = 0;
  for (const [status, count] of ladder) {
    for (let i = 0; i < count; i += 1) {
      const company = COMPANIES[Math.floor(random() * COMPANIES.length)];
      const [title, strategy] = titles[Math.floor(random() * titles.length)];
      n += 1;
      rows.push({
        id: `preview-outreach-${n}`,
        company,
        role: ROLES[Math.floor(random() * ROLES.length)],
        job_id: `https://jobs.example.com/${n}`,
        status,
        strategy,
        relevance_score: 40 + Math.floor(random() * 60),
        relevance_reasons: ["same team", "alumni"],
        contact:
          status === "NEEDS_CONTACT"
            ? {}
            : {
                full_name: `Sample Person ${n}`,
                current_title: title,
                linkedin_url: "https://www.linkedin.com/in/example",
                connection_status: random() > 0.5 ? "CONNECTED" : "REQUESTED"
              },
        generated_message: "Sample outreach draft for design preview only.",
        quality: { verdict: "PASS" }
      });
    }
  }
  const companies = COMPANIES.slice(0, 9).map((company) => ({
    company,
    jobs: [1, 2],
    sent: Math.floor(random() * 3) + 1,
    cap: 3,
    recruiters: 1,
    employees: 2,
    replies: Math.floor(random() * 2),
    remaining: Math.floor(random() * 2),
    connected: Math.floor(random() * 3),
    connectionsRequested: Math.floor(random() * 3),
    contacts: [
      { name: "Sample Recruiter", strategy: "RECRUITER", status: "SENT" },
      { name: "Sample Engineer", strategy: "ENGINEER", status: "REPLIED" }
    ]
  }));
  return {
    stats: {
      needsReview: 11,
      needsContact: 22,
      approved: 9,
      sent: 31,
      replies: 12,
      positive: 7,
      referrals: 3,
      responseRate: 39,
      referralRate: 10,
      smallSample: false,
      complete: false,
      experiment: { id: 1, name: "Outreach round 1", target: 40 },
      byStrategy: {
        RECRUITER: { messages: 12, replies: 3, referrals: 1 },
        ENGINEER: { messages: 9, replies: 4, referrals: 1 },
        ALUMNI: { messages: 7, replies: 4, referrals: 1 },
        MANAGER: { messages: 3, replies: 1, referrals: 0 }
      }
    },
    rows,
    companies,
    dueFollowUps: rows.slice(0, 2).map((row) => ({ id: row.id, company: row.company, role: row.role })),
    ranked: COMPANIES.slice(0, 12).map((company, i) => ({
      company,
      role: ROLES[i % ROLES.length],
      url: `https://jobs.example.com/${i}`,
      tier: ["A", "A", "B", "C"][i % 4],
      submitted_at: isoDay(i * 3)
    }))
  };
}

export function previewState(): TrackerState {
  const random = rng(20260918);
  const applications = buildApplications(random);
  const inbox = buildInbox(random, applications);
  const outreach = buildOutreach(random);
  const counts = applications.reduce(
    (acc, row) => {
      if (row.status === "submitted") acc.submitted += 1;
      else if (row.status === "rejected") acc.rejected += 1;
      else if (row.status === "filled_awaiting_submit") acc.waiting += 1;
      else acc.blocked += 1;
      return acc;
    },
    { submitted: 0, rejected: 0, waiting: 0, blocked: 0 }
  );
  return {
    generatedAt: new Date().toISOString(),
    agent: "working",
    agentLabel: "Sample data",
    agentDetail: "design preview · not real activity",
    counts: {
      ...counts,
      total: applications.length,
      queue: 18,
      needsYou: inbox.actions.length,
      askMe: 7,
      outreachReview: 11
    },
    inbox,
    needed: Array.from({ length: 7 }, (_, i) => ({
      id: `preview-needed-${i}`,
      question: [
        "Preferred US cities or offices",
        "Link to a project you are proud of",
        "Personal website URL",
        "Professional references",
        "Have you worked here before?",
        "Preferred start date",
        "Earliest start date"
      ][i],
      note: "Sample question for design preview.",
      company: "profile"
    })),
    applications,
    outreach,
    flow: buildFlowData({ applications, inbox, outreach: outreach.rows }),
    setup: { complete: true, missing: [], outreachError: null }
  };
}

export function previewResume(): ResumeState {
  const random = rng(77);
  const tailored = COMPANIES.slice(0, 11).map((company, i) => {
    const matched = KEYWORDS.filter(() => random() > 0.45);
    const missing = KEYWORDS.filter((k) => !matched.includes(k) && random() > 0.55);
    return {
      company,
      role: ROLES[i % ROLES.length],
      jobUrl: `https://jobs.example.com/${i}`,
      pdfPath: `resumes/tailored/sample-${i}.pdf`,
      score: 42 + Math.floor(random() * 55),
      matched,
      missing,
      generatedAt: new Date(Date.now() - i * 86400000).toISOString()
    };
  });
  return { available: true, hasContent: true, tailored };
}

export function previewCorpus(): CorpusState {
  return {
    available: true,
    sources: [
      { name: "demo-api", kind: "repo", path: "/Users/sample/code/demo-api", evidenceCount: 1284, lastScanned: new Date().toISOString(), error: null },
      { name: "demo-web", kind: "repo", path: "/Users/sample/code/demo-web", evidenceCount: 963, lastScanned: new Date().toISOString(), error: null },
      { name: "demo-cli", kind: "repo", path: "/Users/sample/code/demo-cli", evidenceCount: 412, lastScanned: new Date().toISOString(), error: null },
      { name: "project-notes", kind: "docs", path: "/Users/sample/notes", evidenceCount: 508, lastScanned: new Date().toISOString(), error: null },
      { name: "archive", kind: "repo", path: "/Users/sample/code/archive", evidenceCount: 87, lastScanned: null, error: "Not a git repository — scanned as plain files." }
    ],
    totals: {
      sources: 5,
      evidence: 3254,
      byKind: { repo: 2746, docs: 508 },
      byConfidence: { verified: 2231, stated: 1023 }
    },
    lastScanned: new Date().toISOString()
  };
}

export function previewEvidence(count = 240): Evidence[] {
  const random = rng(4242);
  const rows: Evidence[] = [];
  for (let i = 0; i < count; i += 1) {
    const verified = random() > 0.35;
    const keyword = KEYWORDS[Math.floor(random() * KEYWORDS.length)];
    rows.push({
      id: `preview-evidence-${i}`,
      kind: random() > 0.3 ? "repo" : "docs",
      text: verified
        ? `Sample verified fact ${i}: shipped a ${keyword} change across ${2 + Math.floor(random() * 40)} files.`
        : `Sample stated claim ${i}: notes describe ${keyword} work without a commit behind it.`,
      verbatim: random() > 0.85,
      provenance: verified
        ? {
            file: `src/${keyword.replace(/\s+/g, "-")}/module-${i}.ts`,
            line: 1 + Math.floor(random() * 300),
            commit: `${Math.floor(random() * 1e16).toString(16)}`,
            date: new Date(Date.now() - Math.floor(random() * 400) * 86400000).toISOString()
          }
        : { file: `notes/${keyword.replace(/\s+/g, "-")}.md` },
      tags: [keyword, verified ? "shipped" : "claimed"],
      metrics: verified ? { commits: 1 + Math.floor(random() * 60), files: 1 + Math.floor(random() * 30) } : {},
      confidence: verified ? "verified" : "stated"
    });
  }
  return rows;
}
