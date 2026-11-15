// Starts the server on a throwaway data folder and checks that each write
// action changes what /api/state reports.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 4471;
const base = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "job-desk-test-"));
let server;

const get = async (path) => (await fetch(base + path)).json();
async function post(path, body, expectOk = true) {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (expectOk) assert.equal(res.status, 200, json.error);
  return { status: res.status, json };
}

before(async () => {
  server = spawn(process.execPath, ["server/index.mjs"], { env: { ...process.env, PORT: String(PORT), JOB_DESK_DATA: data }, stdio: "ignore" });
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`${base}/api/state`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server did not start");
});

after(() => {
  server?.kill();
  rmSync(data, { recursive: true, force: true });
});

test("a fresh data folder is seeded with demo records", async () => {
  const state = await get("/api/state");
  assert.ok(state.counts.total > 20);
  assert.ok(state.outreach.rows.length > 5);
  assert.ok(state.flow.applications.total === state.counts.total);
  const corpus = await get("/api/corpus/state");
  assert.ok(corpus.totals.evidence > 0);
});

test("mark submitted, add job, dismiss, answer and skip all persist", async () => {
  let state = await get("/api/state");
  const ready = state.applications.find((a) => a.status === "filled_awaiting_submit");
  await post("/api/applications/mark-submitted", { url: ready.url });
  await post("/api/applications", { company: "Test Co", role: "Engineer", url: "https://jobs.example.com/test-co/1", status: "planned" });
  await post("/api/dismiss-action", { uid: state.inbox.actions[0].uid });
  await post("/api/needed-answer", { id: state.needed[0].id, answer: "June 2027" });
  await post("/api/needed-dismiss", { id: state.needed[1].id });

  const next = await get("/api/state");
  assert.equal(next.applications.find((a) => a.url === ready.url).status, "submitted");
  assert.ok(next.applications.some((a) => a.company === "Test Co"));
  assert.equal(next.inbox.actions.length, state.inbox.actions.length - 1);
  assert.equal(next.needed.length, state.needed.length - 2);
  state = next;
});

test("profile saves with the current revision and rejects a stale one", async () => {
  const current = await get("/api/profile");
  const profile = { ...current.profile, personal: { ...current.profile.personal, phone: "555-0100" } };
  const saved = await post("/api/profile", { profile, revision: current.revision });
  assert.equal(saved.json.profile.personal.phone, "555-0100");
  const stale = await post("/api/profile", { profile, revision: current.revision }, false);
  assert.equal(stale.status, 409);
  assert.equal((await get("/api/state")).setup.complete, true);
});

test("outreach: add a person, edit, move through statuses", async () => {
  const before = await get("/api/state");
  const job = before.outreach.rows.find((r) => r.status === "NEEDS_CONTACT");
  await post("/api/outreach/contact", { full_name: "Robin Sample", current_title: "Recruiter", job_url: job.job_id, company: job.company });
  let row = (await get("/api/state")).outreach.rows.find((r) => r.id === job.id);
  assert.equal(row.status, "NEEDS_REVIEW");
  assert.equal(row.strategy, "RECRUITER");
  await post("/api/outreach/update", { id: row.id, message: `Hi Robin, a short note about ${row.company}.` });
  await post("/api/outreach/update", { id: row.id, status: "SENT" });
  await post("/api/outreach/update", { id: row.id, connection_status: "REQUESTED" });
  row = (await get("/api/state")).outreach.rows.find((r) => r.id === job.id);
  assert.equal(row.status, "SENT");
  assert.equal(row.contact.connection_status, "REQUESTED");
  assert.match(row.final_message, /Robin/);
});

test("jobs can be tracked and removed endpoints say so", async () => {
  const jobs = await get("/api/jobs");
  const open = jobs.jobs.find((j) => j.status === "live" && !j.tracked);
  await post("/api/jobs/track", { key: open.key });
  assert.equal((await get("/api/jobs")).jobs.find((j) => j.key === open.key).tracked, true);
  const gone = await post("/api/submit", {}, false);
  assert.equal(gone.status, 501);
  assert.match(gone.json.error, /not available in this build/i);
});

test("writes from another site are refused", async () => {
  const res = await fetch(`${base}/api/needed-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify({ question: "x", answer: "y" })
  });
  assert.equal(res.status, 403);
});
