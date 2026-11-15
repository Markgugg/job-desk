// Outreach: people at companies you applied to, and the messages you send them.
// Drafts come from a plain template filled with your profile and the job, so
// nothing here calls a model or drives a browser. You copy, send, and record.
import { BASE_RESUME, newId, read, update } from "./store.mjs";
import { loadProfile } from "./profile.mjs";
import { existsSync } from "node:fs";

const EMPTY = { experiment: { id: 1, name: "Outreach round 1", target: 10 }, contacts: [], messages: [] };
const COMPANY_CAP = 3;
const FOLLOW_UP_DAYS = 5;
const NOTE_LIMIT = 300;

export const STATUSES = [
  "NEEDS_CONTACT", "DRAFTED", "NEEDS_REVIEW", "APPROVED", "SENT", "FOLLOW_UP_NEEDED",
  "REPLIED", "POSITIVE_REPLY", "REFERRAL_OFFERED", "REFERRAL_RECEIVED", "SKIPPED"
];
const WENT_OUT = new Set(["SENT", "FOLLOW_UP_NEEDED", "REPLIED", "POSITIVE_REPLY", "REFERRAL_OFFERED", "REFERRAL_RECEIVED"]);
const ANSWERED = new Set(["REPLIED", "POSITIVE_REPLY", "REFERRAL_OFFERED", "REFERRAL_RECEIVED"]);
const WARM = new Set(["POSITIVE_REPLY", "REFERRAL_OFFERED", "REFERRAL_RECEIVED"]);

export const loadOutreach = () => read("outreach", EMPTY);

function strategyFor(contact, school) {
  const title = `${contact.current_title || ""} ${contact.notes || ""}`.toLowerCase();
  const sharedSchool = school && String(contact.university || "").toLowerCase().includes(school.toLowerCase());
  if (/recruit|talent|sourcer/.test(title)) return "RECRUITER";
  if (sharedSchool || /\balum/.test(title)) return "ALUMNI";
  if (/manager|director|head of|lead/.test(title)) return "MANAGER";
  return "ENGINEER";
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "there";
}

function draftFor({ contact, company, role, strategy }) {
  const me = loadProfile();
  const sign = me.personal.first_name || "Me";
  const school = me.education.school;
  const opener = strategy === "ALUMNI" && school
    ? `fellow ${school} grad here.`
    : strategy === "RECRUITER"
      ? "I just applied to a role on your team's board."
      : "I just applied to a role on your team.";
  const ask = strategy === "RECRUITER"
    ? "Could you point me to the right person for it?"
    : "Would you be open to a quick chat about the team?";
  const roleBit = role ? ` for ${role}` : "";
  return `Hi ${firstName(contact.full_name)}, ${opener} It's at ${company}${roleBit}. ${ask} Thanks, ${sign}`;
}

function qualityOf(message, company) {
  const reasons = [];
  if (!message.trim()) reasons.push("Message is empty");
  if (message.length > NOTE_LIMIT) reasons.push(`Over ${NOTE_LIMIT} characters, too long for a connection note`);
  if (company && !message.toLowerCase().includes(company.toLowerCase())) reasons.push("Does not name the company");
  if (/[{}]/.test(message)) reasons.push("Has an unfilled placeholder");
  return reasons.length ? { verdict: "FIX", reasons } : { verdict: "PASS", reasons: [] };
}

function searchPlan(company, school) {
  const people = (q) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
  return [
    { kind: "recruiter", url: people(`${company} recruiter`) },
    { kind: "engineer", url: people(`${company} software engineer`) },
    ...(school ? [{ kind: "alumni", url: people(`${company} ${school}`) }] : [])
  ];
}

function daysSince(iso) {
  const at = Date.parse(iso || "");
  return Number.isFinite(at) ? (Date.now() - at) / 86400000 : 0;
}

/** Submitted jobs, ranked by how much outreach effort they deserve. */
export function rankJobs(applications, matches) {
  const scoreByUrl = new Map(matches.map((m) => [m.url, m.score]));
  const tierOf = (app) => {
    const score = scoreByUrl.get(app.url);
    if (typeof score === "number") return score >= 85 ? "A" : score >= 70 ? "B" : "C";
    return Number(app.salary) >= 150000 ? "B" : "C";
  };
  return applications
    .filter((app) => app.status === "submitted")
    .map((app) => ({ company: app.company, role: app.role, url: app.url, tier: tierOf(app), submitted_at: app.submitted_at }))
    .sort((a, b) => a.tier.localeCompare(b.tier) || String(b.submitted_at).localeCompare(String(a.submitted_at)));
}

export function outreachDashboard({ applications, matches }) {
  const store = loadOutreach();
  const school = loadProfile().education.school;
  const contacts = new Map(store.contacts.map((c) => [c.id, c]));
  const resumeHref = existsSync(BASE_RESUME) ? "/resumes/RESUME.pdf" : undefined;

  const rows = store.messages.map((m) => {
    const contact = contacts.get(m.contact_id) || {};
    const message = m.final_message ?? m.generated_message ?? "";
    const due = m.status === "SENT" && daysSince(m.sent_at) >= FOLLOW_UP_DAYS;
    return {
      ...m,
      contact,
      quality: m.status === "NEEDS_CONTACT" ? undefined : qualityOf(message, m.company),
      search_plan: m.status === "NEEDS_CONTACT" ? searchPlan(m.company, school) : undefined,
      followUpDraft: due
        ? `Hi ${firstName(contact.full_name)}, just following up on my note about ${m.role || "the role"} at ${m.company}. Happy to send anything that helps. Thanks again!`
        : undefined,
      resumeReply: WARM.has(m.status)
        ? `Thank you, that means a lot. My resume is attached, and the posting is ${m.job_id}. Let me know if anything else would help.`
        : undefined,
      resume: WARM.has(m.status) && resumeHref ? { href: resumeHref } : undefined
    };
  });

  const sent = rows.filter((r) => WENT_OUT.has(r.status));
  const replies = rows.filter((r) => ANSWERED.has(r.status)).length;
  const referrals = rows.filter((r) => r.status === "REFERRAL_RECEIVED").length;
  const pct = (n) => (sent.length ? Math.round((n / sent.length) * 100) : 0);
  const byStrategy = {};
  for (const row of sent) {
    const key = row.strategy || "OTHER";
    byStrategy[key] ??= { messages: 0, replies: 0, referrals: 0 };
    byStrategy[key].messages += 1;
    if (ANSWERED.has(row.status)) byStrategy[key].replies += 1;
    if (row.status === "REFERRAL_RECEIVED") byStrategy[key].referrals += 1;
  }
  const count = (status) => rows.filter((r) => r.status === status).length;

  const companyNames = [...new Set(rows.map((r) => r.company))].sort();
  const companies = companyNames.map((company) => {
    const mine = rows.filter((r) => r.company === company && r.status !== "SKIPPED");
    const people = mine.filter((r) => r.contact?.full_name);
    return {
      company,
      jobs: applications.filter((a) => a.company === company && a.status === "submitted").map((a) => a.url),
      sent: mine.filter((r) => WENT_OUT.has(r.status)).length,
      cap: COMPANY_CAP,
      recruiters: people.filter((r) => r.strategy === "RECRUITER").length,
      employees: people.filter((r) => r.strategy !== "RECRUITER").length,
      replies: mine.filter((r) => ANSWERED.has(r.status)).length,
      remaining: Math.max(0, COMPANY_CAP - people.length),
      connected: people.filter((r) => r.contact.connection_status === "CONNECTED").length,
      connectionsRequested: people.filter((r) => r.contact.connection_status === "REQUESTED").length,
      contacts: people.map((r) => ({ name: r.contact.full_name, strategy: r.strategy, status: r.status }))
    };
  });

  return {
    stats: {
      needsReview: count("NEEDS_REVIEW"),
      needsContact: count("NEEDS_CONTACT"),
      approved: count("APPROVED"),
      sent: sent.length,
      replies,
      positive: rows.filter((r) => WARM.has(r.status)).length,
      referrals,
      responseRate: pct(replies),
      referralRate: pct(referrals),
      smallSample: sent.length > 0 && sent.length < 10,
      complete: sent.length >= store.experiment.target,
      experiment: store.experiment,
      byStrategy
    },
    rows,
    ranked: rankJobs(applications, matches),
    companies,
    dueFollowUps: rows.filter((r) => r.followUpDraft).map((r) => ({ id: r.id, company: r.company, role: r.role }))
  };
}

/** Queue a "find a person" slot for each top-ranked job that has no outreach yet. */
export function prepareRound({ applications, matches }) {
  let added = 0;
  update("outreach", EMPTY, (store) => {
    const covered = new Set(store.messages.filter((m) => m.status !== "SKIPPED").map((m) => m.job_id));
    const open = store.messages.filter((m) => !WENT_OUT.has(m.status) && m.status !== "SKIPPED").length;
    const room = Math.max(0, store.experiment.target - open);
    for (const job of rankJobs(applications, matches)) {
      if (added >= room) break;
      if (job.tier === "C" || covered.has(job.url)) continue;
      store.messages.push({
        id: newId("msg"), company: job.company, role: job.role, job_id: job.url, contact_id: null,
        strategy: "", status: "NEEDS_CONTACT", relevance_score: null,
        relevance_reasons: [`Tier ${job.tier} application`], notes: "",
        history: [{ status: "NEEDS_CONTACT", at: new Date().toISOString() }], created_at: new Date().toISOString()
      });
      covered.add(job.url);
      added += 1;
    }
  });
  return { added };
}

export function addContact(body, applications) {
  const name = String(body.full_name || "").trim();
  if (!name) throw new Error("Add the person's name.");
  const jobUrl = String(body.job_url || "").trim();
  const app = applications.find((a) => jobUrl && a.url === jobUrl);
  const company = String(body.company || app?.company || "").trim();
  if (!company) throw new Error("Add the company, or a job URL that is already tracked.");
  const school = loadProfile().education.school;
  let created;
  update("outreach", EMPTY, (store) => {
    const contact = {
      id: newId("person"),
      full_name: name,
      current_title: String(body.current_title || "").trim(),
      company,
      linkedin_url: String(body.linkedin_url || "").trim(),
      university: String(body.university || "").trim(),
      notes: String(body.notes || "").trim(),
      connection_status: ""
    };
    store.contacts.push(contact);
    const strategy = strategyFor(contact, school);
    const slot = store.messages.find((m) => m.status === "NEEDS_CONTACT" && (jobUrl ? m.job_id === jobUrl : m.company === company));
    const role = slot?.role || app?.role || "";
    const now = new Date().toISOString();
    const fields = {
      contact_id: contact.id,
      strategy,
      status: "NEEDS_REVIEW",
      generated_message: draftFor({ contact, company, role, strategy }),
      relevance_score: strategy === "ALUMNI" ? 80 : strategy === "RECRUITER" ? 70 : 60,
      relevance_reasons: [strategy === "ALUMNI" ? "Shared school" : strategy === "RECRUITER" ? "Hires for the team" : "Works near the role"],
      notes: contact.notes
    };
    if (slot) {
      Object.assign(slot, fields);
      slot.history = [...(slot.history || []), { status: "NEEDS_REVIEW", at: now }];
      created = slot;
    } else {
      created = { id: newId("msg"), company, role, job_id: jobUrl || app?.url || "", ...fields, history: [{ status: "NEEDS_REVIEW", at: now }], created_at: now };
      store.messages.push(created);
    }
  });
  return created;
}

export function updateMessage(body) {
  let changed;
  update("outreach", EMPTY, (store) => {
    const row = store.messages.find((m) => m.id === body.id);
    if (!row) throw new Error("That outreach record no longer exists.");
    const now = new Date().toISOString();
    if (body.message !== undefined) {
      const message = String(body.message).trim();
      if (!message) throw new Error("The message cannot be empty.");
      row.final_message = message;
    }
    if (body.status !== undefined) {
      const status = String(body.status).toUpperCase();
      if (!STATUSES.includes(status)) throw new Error(`Unknown status ${status}.`);
      if (status === "SENT" && !row.sent_at) row.sent_at = now;
      row.status = status;
      row.history = [...(row.history || []), { status, at: now }];
    }
    if (body.connection_status !== undefined) {
      const value = String(body.connection_status).toUpperCase();
      if (!["REQUESTED", "CONNECTED", ""].includes(value)) throw new Error("Unknown connection status.");
      const contact = store.contacts.find((c) => c.id === row.contact_id);
      if (!contact) throw new Error("Attach a person before tracking a connection.");
      contact.connection_status = value;
    }
    changed = row;
  });
  return changed;
}
