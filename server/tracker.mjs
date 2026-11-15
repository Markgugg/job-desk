// Applications, employer inbox events, open form questions and job matches,
// plus the /api/state snapshot the dashboard polls.
import { buildFlowData } from "../src/lib/flow-model.mjs";
import { newId, read, today, update, write } from "./store.mjs";
import { missingFields } from "./profile.mjs";
import { loadOutreach, outreachDashboard } from "./outreach.mjs";

const SUBMITTED = new Set(["submitted", "interview", "offer"]);

export const loadApplications = () => read("applications", []);
export const loadInbox = () => {
  const inbox = read("inbox", { actions: [], rejections: [] });
  return { actions: inbox.actions || [], rejections: inbox.rejections || [] };
};
export const loadNeeded = () => read("needed", []);
export const loadJobs = () => read("jobs", { updatedAt: null, jobs: [] });

function publicApplication(app) {
  const { company, role, url, status, submitted_at, salary } = app;
  return { company, role, url, status, submitted_at: submitted_at || "", salary: salary ?? null, live: null };
}

export function addApplication(body) {
  const company = String(body.company || "").trim();
  const role = String(body.role || "").trim();
  const url = String(body.url || "").trim();
  if (!company || !role) throw new Error("Add a company and a role.");
  if (url && !/^https?:\/\//i.test(url)) throw new Error("The job link has to start with http:// or https://.");
  const status = body.status === "submitted" ? "submitted" : "filled_awaiting_submit";
  const apps = loadApplications();
  const key = url || `manual:${company}:${role}`.toLowerCase().replace(/\s+/g, "-");
  if (apps.some((a) => a.url === key)) throw new Error("That job is already tracked.");
  const app = {
    id: newId("app"), company, role, url: key, status,
    submitted_at: today(),
    salary: Number(body.salary) || null, notes: ""
  };
  write("applications", [app, ...apps]);
  return publicApplication(app);
}

export function markSubmitted(url) {
  let result;
  update("applications", [], (apps) => {
    const app = apps.find((a) => a.url === url);
    if (!app) throw new Error("That job is not in the tracker.");
    if (app.status === "submitted") throw new Error("Already recorded as submitted.");
    app.status = "submitted";
    app.submitted_at = today();
    result = publicApplication(app);
  });
  return result;
}

export function dismissAction(uid) {
  if (!uid) throw new Error("Missing the inbox item id.");
  update("dismissed", [], (list) => (list.includes(uid) ? list : [...list, uid]));
  return { ok: true };
}

export function answerQuestion(body) {
  const answer = String(body.answer || "").trim();
  if (!answer) throw new Error("Write an answer before saving.");
  let question = String(body.question || "").trim();
  if (body.id) {
    update("needed", [], (rows) => {
      const row = rows.find((r) => r.id === body.id);
      if (!row) throw new Error("That question is no longer open.");
      row.status = "answered";
      question = row.question;
    });
  }
  if (!question) throw new Error("Write the question too.");
  update("answers", [], (rows) => [
    ...rows.filter((r) => r.question.toLowerCase() !== question.toLowerCase()),
    { question, answer, saved_at: new Date().toISOString() }
  ]);
  return { ok: true, question };
}

export function skipQuestion(id) {
  update("needed", [], (rows) => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error("That question is no longer open.");
    row.status = "skipped";
  });
  return { ok: true };
}

/** Job matches, each flagged with whether it is already in the tracker. */
export function jobMatches() {
  const data = loadJobs();
  const tracked = new Set(loadApplications().map((a) => a.url));
  const jobs = (data.jobs || []).map((job) => ({ ...job, tracked: tracked.has(job.url) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const by = (status) => jobs.filter((j) => j.status === status).length;
  return {
    updatedAt: data.updatedAt,
    profileChanged: false,
    jobs,
    counts: { total: jobs.length, live: by("live"), closed: by("closed"), unverified: by("unverified") },
    sources: []
  };
}

export function trackMatch(key) {
  const job = (loadJobs().jobs || []).find((j) => j.key === key);
  if (!job) throw new Error("That posting is no longer in the list.");
  return addApplication({ company: job.company, role: job.role, url: job.url, salary: job.salary, status: "planned" });
}

export function trackerState() {
  const applications = loadApplications();
  const inbox = loadInbox();
  const dismissed = new Set(read("dismissed", []));
  const needed = loadNeeded().filter((q) => q.status === "open")
    .map(({ id, question, note, company, url }) => ({ id, question, note, company, url }));
  const matches = loadJobs().jobs || [];
  const outreach = outreachDashboard({ applications, matches });
  const store = loadOutreach();
  const people = new Map(store.contacts.map((c) => [c.id, c]));
  const missing = missingFields();
  const openActions = inbox.actions.filter((a) => !dismissed.has(String(a.uid)));
  const tracked = new Set(applications.map((a) => a.url));
  const waiting = applications.filter((a) => a.status === "filled_awaiting_submit").length;

  const counts = {
    submitted: applications.filter((a) => SUBMITTED.has(a.status)).length,
    rejected: inbox.rejections.length,
    waiting,
    blocked: applications.filter((a) => !SUBMITTED.has(a.status) && !["rejected", "filled_awaiting_submit"].includes(a.status)).length,
    queue: matches.filter((j) => j.status === "live" && !tracked.has(j.url)).length,
    total: applications.length,
    needsYou: openActions.length + needed.length,
    askMe: needed.length,
    outreachReview: outreach.stats.needsReview + outreach.stats.needsContact
  };

  return {
    generatedAt: new Date().toISOString(),
    agent: "ready",
    agentLabel: waiting ? `${waiting} ready to submit` : "Up to date",
    agentDetail: "Saved on this computer",
    counts,
    inbox: { actions: openActions, rejections: inbox.rejections, codes: [] },
    needed,
    applications: applications.map(publicApplication),
    // Dismissed inbox items still count as an employer response in the flow.
    flow: buildFlowData({
      applications,
      inbox,
      outreach: store.messages.map((m) => ({ ...m, contact: people.get(m.contact_id) }))
    }),
    outreach,
    setup: { complete: missing.length === 0, missing, outreachError: null }
  };
}
