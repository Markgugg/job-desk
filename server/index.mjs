#!/usr/bin/env node
// Job Desk server: serves the built dashboard from dist/ and a small JSON API
// backed by files in data/. Node built-ins only.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { BASE_RESUME, ROOT, RESUME_DIR, read } from "./store.mjs";
import { editableProfile, saveProfile } from "./profile.mjs";
import {
  addApplication, answerQuestion, dismissAction, jobMatches, loadApplications, loadJobs,
  markSubmitted, skipQuestion, trackMatch, trackerState
} from "./tracker.mjs";
import { addContact, prepareRound, updateMessage } from "./outreach.mjs";
import * as corpus from "./corpus-api.mjs";
import { allEvidence } from "./corpus-store.mjs";
import { seedIsNeeded, writeSeed } from "./seed.mjs";

const PORT = Number(process.env.PORT || 4400);
const HOST = process.env.HOST || "127.0.0.1";
const DIST = join(ROOT, "dist");
const MAX_PDF_BYTES = 8 * 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".pdf": "application/pdf"
};

// Endpoints from the automated build (browser form filling, auto submit, AI
// tailoring, LinkedIn research). This build does not include them.
const NOT_IN_THIS_BUILD = new Set([
  "/api/automations/start", "/api/automations/stop", "/api/automations/browser", "/api/automations/focus",
  "/api/submit", "/api/submit-all", "/api/resume/tailor", "/api/resume/preview", "/api/outreach/research"
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(payload);
}

async function body(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(req) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
    throw new HttpError(415, "Send JSON from the dashboard.");
  }
  const raw = (await body(req)).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "That request body is not valid JSON.");
  }
}

/** Writes must come from this dashboard (or the Vite dev server), not another site. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return ["127.0.0.1", "localhost", HOST].includes(hostname);
  } catch {
    return false;
  }
}

const csv = (params, key) => (params.get(key) || "").split(",").map((s) => s.trim()).filter(Boolean);

function tally(rows, pick) {
  const counts = new Map();
  for (const row of rows) for (const value of [].concat(pick(row) ?? [])) if (value) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function resumeState() {
  return {
    available: true,
    staticReady: existsSync(BASE_RESUME),
    hasContent: true,
    tailored: read("tailored", [])
  };
}

const routes = {
  "GET /api/state": () => trackerState(),

  "GET /api/profile": () => editableProfile(),
  "POST /api/profile": async ({ req }) => saveProfile(await jsonBody(req)),

  "POST /api/applications": async ({ req }) => addApplication(await jsonBody(req)),
  "POST /api/applications/mark-submitted": async ({ req }) => markSubmitted((await jsonBody(req)).url),
  "POST /api/dismiss-action": async ({ req }) => dismissAction(String((await jsonBody(req)).uid || "")),
  "POST /api/needed-answer": async ({ req }) => answerQuestion(await jsonBody(req)),
  "POST /api/needed-dismiss": async ({ req }) => skipQuestion((await jsonBody(req)).id),

  "GET /api/jobs": ({ url }) => {
    const data = jobMatches();
    const key = url.searchParams.get("key");
    if (!key) return data;
    const job = data.jobs.find((j) => j.key === key);
    if (!job) throw new HttpError(404, "That posting is no longer in the list.");
    return job;
  },
  "POST /api/jobs/track": async ({ req }) => trackMatch((await jsonBody(req)).key),

  "POST /api/outreach/prepare": async ({ req }) => {
    await jsonBody(req);
    return prepareRound({ applications: loadApplications(), matches: loadJobs().jobs || [] });
  },
  "POST /api/outreach/contact": async ({ req }) => addContact(await jsonBody(req), loadApplications()),
  "POST /api/outreach/update": async ({ req }) => updateMessage(await jsonBody(req)),

  "GET /api/corpus/state": () => ({ available: true, ...corpus.corpusState() }),
  "POST /api/corpus/source": async ({ req }) => {
    const { name, kind, path } = await jsonBody(req);
    if (!String(path || "").startsWith("/")) throw new HttpError(400, "Use an absolute path, starting with /.");
    if (!existsSync(path)) throw new HttpError(400, `Nothing exists at ${path}.`);
    const added = corpus.addSource({ name, kind, path });
    if (!added.ok) throw new HttpError(400, added.error);
    return { available: true, ...corpus.corpusState() };
  },
  "DELETE /api/corpus/source": ({ url }) => {
    const removed = corpus.removeSource(url.searchParams.get("name") || "");
    if (!removed.ok) throw new HttpError(400, removed.error);
    return { available: true, ...corpus.corpusState() };
  },
  "POST /api/corpus/scan": async ({ req }) => {
    const { name } = await jsonBody(req);
    return name ? corpus.scanSource(name) : corpus.scanAll();
  },
  "GET /api/corpus/facets": () => {
    const rows = allEvidence();
    return {
      available: true,
      total: rows.length,
      sources: tally(rows, (e) => e.sourceName),
      kinds: tally(rows, (e) => e.kind),
      tags: tally(rows, (e) => e.tags),
      confidence: tally(rows, (e) => e.confidence)
    };
  },
  "GET /api/corpus/query": ({ url }) => {
    const p = url.searchParams;
    const terms = csv(p, "q");
    const options = { limit: Math.min(Number(p.get("limit")) || 50, 1000), includeUnmatched: !terms.length || p.get("all") === "1" };
    if (csv(p, "kinds").length) options.kinds = csv(p, "kinds");
    if (csv(p, "sources").length) options.sources = csv(p, "sources");
    if (p.get("confidence") && p.get("confidence") !== "all") options.confidence = p.get("confidence");
    return { results: corpus.queryEvidence(terms, options) || [] };
  },

  "GET /api/resume/state": () => resumeState(),
  "POST /api/resume/upload": async ({ req }) => {
    if (!String(req.headers["content-type"] || "").startsWith("application/pdf")) throw new HttpError(415, "Choose a PDF file.");
    const pdf = await body(req, MAX_PDF_BYTES);
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(400, "That file is not a PDF.");
    mkdirSync(RESUME_DIR, { recursive: true });
    writeFileSync(BASE_RESUME, pdf);
    return { ok: true, message: "Resume saved. It replaces the previous base PDF." };
  }
};

function serveFile(res, path, extraHeaders = {}) {
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream", ...extraHeaders });
  res.end(readFileSync(path));
}

function serveStatic(res, pathname) {
  if (!existsSync(join(DIST, "index.html"))) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("The dashboard has not been built yet. Run npm run build, then reload.");
    return;
  }
  const target = normalize(join(DIST, decodeURIComponent(pathname)));
  if (target.startsWith(DIST + sep) && existsSync(target) && statSync(target).isFile()) {
    const cache = target.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
    return serveFile(res, target, { "Cache-Control": cache });
  }
  serveFile(res, join(DIST, "index.html"), { "Cache-Control": "no-cache" });
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  if (pathname === "/resumes/RESUME.pdf") {
    if (!existsSync(BASE_RESUME)) return send(res, 404, { error: "No base resume uploaded yet." });
    return serveFile(res, BASE_RESUME, { "Cache-Control": "no-store" });
  }
  if (!pathname.startsWith("/api/")) return serveStatic(res, pathname);

  if (req.method !== "GET" && !sameOrigin(req)) return send(res, 403, { error: "Changes have to come from the local dashboard." });
  if (NOT_IN_THIS_BUILD.has(pathname)) return send(res, 501, { error: "Not available in this build." });

  const route = routes[`${req.method} ${pathname}`];
  if (!route) return send(res, 404, { error: `No route for ${req.method} ${pathname}.` });
  try {
    send(res, 200, await route({ req, url }));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : err?.status || 400;
    send(res, status, { error: String(err?.message || err) });
  }
}

if (seedIsNeeded()) {
  const seeded = writeSeed();
  console.log(`First run: wrote demo data (${seeded.applications} applications, ${seeded.evidence} evidence items).`);
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (!res.headersSent) send(res, 500, { error: String(err?.message || err) });
    else res.end();
  });
}).listen(PORT, HOST, () => {
  console.log(`Job Desk running at http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`);
});
