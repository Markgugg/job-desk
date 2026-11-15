// Demo dataset for a fresh clone. Every company, person, link and number here
// is made up. Dates are generated relative to today so the charts always have
// a recent history to draw.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_RESUME, DATA_DIR, RESUME_DIR, ROOT, write } from "./store.mjs";
import { addSource, scanAll } from "./corpus-api.mjs";

const COMPANIES = [
  "Acme Robotics", "Globex Analytics", "Initech Labs", "Bluefin Payments", "Lumen Health",
  "Orbital Freight", "Tidewater AI", "Copperline Software", "Redwood Games", "Quartz Security",
  "Harborview Fintech", "Meridian Maps", "Summit Learning", "Pinewood Media", "Saffron Retail",
  "Vantage Mobility", "Kestrel Energy", "Juniper Bio", "Nimbus Devices", "Arcadia Travel"
];
const ROLES = [
  "Software Engineer, New Grad", "Frontend Engineer", "Backend Engineer", "Full Stack Engineer",
  "Platform Engineer", "Data Engineer", "Product Engineer", "Infrastructure Engineer"
];
const FIRST = ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Harper", "Jules", "Kai", "Logan", "Morgan", "Noor", "Parker", "Quinn", "Reese", "Sage"];
const LAST = ["Sample", "Example", "Demo", "Placeholder", "Testcase", "Mockwell"];
const SKILLS = ["typescript", "react", "node", "postgres", "python", "aws", "docker", "graphql", "redis", "kubernetes", "go", "testing", "ci/cd", "accessibility"];

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const random = prng(1729);
const pick = (list) => list[Math.floor(random() * list.length)];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function day(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
const msAgo = (days, hours = 0) => Date.now() - days * 86400000 - hours * 3600000;
const isoAgo = (days) => new Date(msAgo(days)).toISOString();

function buildApplications() {
  const plan = [
    ...Array(40).fill("submitted"),
    ...Array(6).fill("filled_awaiting_submit"),
    ...Array(4).fill("blocked_needs_input"),
    ...Array(3).fill("skipped_location"),
    ...Array(2).fill("needs_retry"),
    "interview", "withdrawn"
  ];
  return plan.map((status, i) => {
    const company = COMPANIES[i % COMPANIES.length];
    const role = ROLES[(i * 3 + Math.floor(i / COMPANIES.length)) % ROLES.length];
    const daysAgo = status === "submitted" || status === "interview" ? 3 + Math.floor(random() * 200) : Math.floor(random() * 14);
    return {
      id: `app_${i + 1}`,
      company,
      role,
      url: `https://jobs.example.com/${slug(company)}/${1000 + i}`,
      status,
      submitted_at: day(daysAgo),
      salary: random() > 0.25 ? pick([115000, 125000, 135000, 145000, 155000, 170000, 185000]) : null,
      notes: ""
    };
  });
}

function buildInbox(apps) {
  const submitted = apps.filter((a) => a.status === "submitted");
  const after = (app, extraDays) => {
    const sent = Date.parse(`${app.submitted_at}T12:00:00`);
    return Math.min(Date.now() - 3600000, sent + extraDays * 86400000);
  };
  const kinds = [
    ["interview", "Let's set up a first conversation"],
    ["assessment", "Your coding exercise is ready"],
    ["reply", "Quick question about your application"],
    ["offer", "Offer details"],
    ["form", "Please complete your candidate profile"]
  ];
  const actions = kinds.map(([kind, subject], i) => {
    const app = submitted[i * 3];
    return { uid: `demo-action-${i + 1}`, company: app.company, role: app.role, subject, kind, at: after(app, 6 + i), url: app.url };
  });
  const rejections = submitted.slice(16, 27).map((app, i) => ({
    uid: `demo-rejection-${i + 1}`, company: app.company, role: app.role,
    subject: "An update on your application", kind: "rejected", at: after(app, 10 + i), url: app.url
  }));
  return { actions, rejections };
}

function buildNeeded(apps) {
  const blocked = apps.filter((a) => a.status === "blocked_needs_input");
  return [
    { id: "q1", question: "Earliest start date", note: "Asked on most new grad forms.", company: "profile", url: "", status: "open" },
    { id: "q2", question: "Preferred office locations", note: "", company: "profile", url: "", status: "open" },
    { id: "q3", question: "Have you worked here before as an intern or contractor?", note: "Required before the form will continue.", company: blocked[0].company, url: blocked[0].url, status: "open" },
    { id: "q4", question: "Link to a project you are proud of", note: "", company: blocked[1].company, url: blocked[1].url, status: "open" }
  ];
}

function buildOutreach(apps) {
  const submitted = apps.filter((a) => a.status === "submitted").slice(0, 14);
  const contacts = [];
  const messages = [];
  const titles = [
    ["Technical Recruiter", "RECRUITER"], ["Software Engineer", "ENGINEER"],
    ["Senior Software Engineer, alum", "ALUMNI"], ["Engineering Manager", "MANAGER"]
  ];
  const ladder = [
    "NEEDS_CONTACT", "NEEDS_CONTACT", "NEEDS_REVIEW", "NEEDS_REVIEW", "NEEDS_REVIEW", "APPROVED",
    "SENT", "SENT", "SENT", "SENT", "REPLIED", "POSITIVE_REPLY", "REFERRAL_OFFERED", "REFERRAL_RECEIVED"
  ];
  ladder.forEach((status, i) => {
    const app = submitted[i];
    const history = [{ status: "NEEDS_CONTACT", at: isoAgo(40 - i) }];
    const row = {
      id: `msg_demo_${i + 1}`, company: app.company, role: app.role, job_id: app.url,
      contact_id: null, strategy: "", status, relevance_score: null, relevance_reasons: ["Tier A application"],
      notes: "", history, created_at: isoAgo(40 - i)
    };
    if (status !== "NEEDS_CONTACT") {
      const [title, strategy] = titles[i % titles.length];
      const person = { id: `person_demo_${i + 1}`, full_name: `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`, current_title: title, company: app.company, linkedin_url: "", university: strategy === "ALUMNI" ? "Example State University" : "", notes: "", connection_status: i % 3 === 0 ? "CONNECTED" : i % 3 === 1 ? "REQUESTED" : "" };
      contacts.push(person);
      Object.assign(row, {
        contact_id: person.id, strategy,
        relevance_score: 55 + ((i * 7) % 40),
        relevance_reasons: [strategy === "ALUMNI" ? "Shared school" : strategy === "RECRUITER" ? "Hires for the team" : "Works near the role"],
        generated_message: `Hi ${person.full_name.split(" ")[0]}, I just applied to a role on your team. It's at ${app.company} for ${app.role}. Would you be open to a quick chat about the team? Thanks, Jordan`
      });
      history.push({ status: "NEEDS_REVIEW", at: isoAgo(30 - i) });
      if (!["NEEDS_REVIEW", "APPROVED"].includes(status)) {
        row.sent_at = isoAgo(i < 8 ? 9 : 14 - i);
        history.push({ status: "SENT", at: row.sent_at });
        if (status !== "SENT") history.push({ status, at: isoAgo(3) });
      } else if (status === "APPROVED") history.push({ status, at: isoAgo(2) });
    }
    messages.push(row);
  });
  messages.push({
    id: "msg_demo_skip", company: submitted[0].company, role: submitted[0].role, job_id: submitted[0].url,
    contact_id: null, strategy: "", status: "SKIPPED", relevance_score: null, relevance_reasons: [], notes: "Team is not hiring this quarter",
    history: [{ status: "SKIPPED", at: isoAgo(20) }], created_at: isoAgo(21)
  });
  return { experiment: { id: 1, name: "Outreach round 1", target: 10 }, contacts, messages };
}

function buildJobs(apps) {
  const jobs = [];
  const dims = (score) => {
    const role = Math.min(15, Math.round(score * 0.15));
    const stage = Math.min(20, Math.round(score * 0.2));
    const skills = Math.min(40, Math.round(score * 0.4));
    const timing = Math.min(15, Math.round(score * 0.15));
    return [
      { name: "Role alignment", points: role, max: 15, reason: "Title and team match your target roles." },
      { name: "Career stage", points: stage, max: 20, reason: "Posting asks for new grad or early career." },
      { name: "Skills evidence", points: skills, max: 40, reason: "Skills in the posting compared with your saved evidence." },
      { name: "Education and timing", points: timing, max: 15, reason: "Graduation date fits the start window." },
      { name: "Location", points: Math.max(0, score - role - stage - skills - timing), max: 10, reason: "Office or remote option fits your preferences." }
    ];
  };
  const used = new Set(apps.slice(0, 12).map((a) => `${a.company}|${a.role}`));
  for (let i = 0; i < 32; i += 1) {
    const company = COMPANIES[(i * 7) % COMPANIES.length];
    let roleIndex = i % ROLES.length;
    while (i >= 6 && used.has(`${company}|${ROLES[roleIndex]}`)) roleIndex = (roleIndex + 1) % ROLES.length;
    const role = ROLES[roleIndex];
    used.add(`${company}|${role}`);
    const trackedApp = i < 6 ? apps[i * 2] : null;
    const status = i % 11 === 10 ? "closed" : i % 13 === 12 ? "unverified" : "live";
    const score = status === "unverified" ? null : Math.max(22, 96 - i * 2 - Math.floor(random() * 6));
    const matched = SKILLS.filter((_, k) => (k + i) % 3 !== 0).slice(0, 5);
    const missing = SKILLS.filter((s) => !matched.includes(s)).slice(0, 2 + (i % 3));
    jobs.push({
      key: `job_${i + 1}`,
      url: trackedApp ? trackedApp.url : `https://jobs.example.com/${slug(company)}/${5000 + i}`,
      company: trackedApp ? trackedApp.company : company,
      role: trackedApp ? trackedApp.role : role,
      location: pick(["Remote, US", "Austin, TX", "Denver, CO", "New York, NY", "Seattle, WA", "Remote"]),
      salary: pick([120000, 135000, 150000, 165000]),
      score,
      status,
      confidence: score === null ? "Not enough information" : score >= 80 ? "High confidence" : "Medium confidence",
      checkedAt: isoAgo(i % 3),
      stale: false,
      locationConfirmed: true,
      blockers: i % 9 === 8 ? ["Requires an active security clearance"] : [],
      unknowns: i % 5 === 4 ? ["Posting does not say whether sponsorship is available"] : [],
      matchedSkills: matched,
      missingSkills: missing,
      dimensions: score === null ? [] : dims(score),
      requirements: [
        { requirement: "Professional or internship software experience", importance: "required", match: "met", quote: "Experience shipping production software, including internships.", evidence: "Internship summary in project notes." },
        { requirement: missing[0] || "Cloud infrastructure", importance: "preferred", match: "missing", quote: `Familiarity with ${missing[0] || "cloud infrastructure"} is a plus.`, evidence: "No saved evidence mentions this yet." }
      ]
    });
  }
  return { updatedAt: isoAgo(0), jobs };
}

function buildTailored(apps) {
  return apps.filter((a) => a.status === "submitted").slice(0, 9).map((app, i) => {
    const matched = SKILLS.filter((_, k) => (k + i) % 2 === 0).slice(0, 4 + (i % 4));
    const missing = SKILLS.filter((s) => !matched.includes(s)).slice(0, 1 + (i % 4));
    return {
      company: app.company, role: app.role, jobUrl: app.url, pdfPath: "",
      score: 58 + ((i * 9) % 38), matched, missing, generatedAt: isoAgo(i * 4 + 1)
    };
  });
}

const PROFILE = {
  personal: { first_name: "Jordan", last_name: "Demo", email: "jordan.demo@example.com", phone: "", city: "Springfield", region: "", country: "United States", phone_country_code: "+1", nationality: "", open_to_relocation: true },
  links: { linkedin: "", github: "https://github.com/example", portfolio: "https://example.com" },
  education: { school: "Example State University", degree: "B.S.", major: "Computer Science", graduation: "May 2027", start_year: 2023, gpa: null, coursework: ["Data Structures", "Operating Systems", "Databases"] },
  eligibility: { authorized: true, needs_sponsorship: false },
  preferences: { roles: ["Software Engineer", "Full Stack Engineer"], locations: ["Remote", "Austin, TX"], remote: true, minimum_salary: 110000 },
  experience: [{ company: "Globex Analytics", title: "Software Engineering Intern", start: "Jun 2025", end: "Aug 2025", summary: "Fictional demo entry: built internal reporting tools." }],
  summary: "Demo profile. Replace every field with your own details."
};

/** A one-page PDF with a few lines of text, so "Open base PDF" has something to show. */
function demoPdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((line, i) => `BT /F1 ${i ? 11 : 18} Tf 72 ${740 - i * 22} Td (${esc(line)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

export function seedIsNeeded() {
  return !existsSync(join(DATA_DIR, "applications.json"));
}

export function writeSeed({ reset = false } = {}) {
  if (reset) {
    for (const name of ["applications", "inbox", "dismissed", "needed", "answers", "outreach", "jobs", "tailored", "profile", "corpus", "corpus-sources"]) {
      rmSync(join(DATA_DIR, `${name}.json`), { force: true });
    }
    rmSync(RESUME_DIR, { recursive: true, force: true });
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const apps = buildApplications();
  write("applications", apps);
  write("inbox", buildInbox(apps));
  write("dismissed", []);
  write("needed", buildNeeded(apps));
  write("answers", []);
  write("outreach", buildOutreach(apps));
  write("jobs", buildJobs(apps));
  write("tailored", buildTailored(apps));
  write("profile", PROFILE);
  mkdirSync(RESUME_DIR, { recursive: true });
  writeFileSync(BASE_RESUME, demoPdf([
    "Jordan Demo",
    "Sample resume for the Job Desk demo. Every detail is fictional.",
    "Example State University, B.S. Computer Science, May 2027",
    "Software Engineering Intern, Globex Analytics (demo), Summer 2025",
    "Upload your own PDF on the Resume tab to replace this file."
  ]));
  const workspace = join(ROOT, "data", "seed", "demo-workspace");
  addSource({ kind: "repo", name: "demo-checkout-service", path: join(workspace, "checkout-service") });
  addSource({ kind: "docs", name: "demo-project-notes", path: join(workspace, "notes") });
  const scan = scanAll();
  return { applications: apps.length, evidence: scan.totals?.evidence ?? 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = writeSeed({ reset: process.argv.includes("--reset") });
  console.log(`Demo data written to ${DATA_DIR}: ${result.applications} applications, ${result.evidence} evidence items.`);
}
