// Tiny JSON-file persistence. One file per collection under data/.
// Writes go to a temp file first and are renamed into place, so a crash
// mid-write never leaves a half-written collection behind.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.JOB_DESK_DATA || join(ROOT, "data");
export const RESUME_DIR = join(DATA_DIR, "resumes");
export const BASE_RESUME = join(RESUME_DIR, "RESUME.pdf");

const file = (name) => join(DATA_DIR, `${name}.json`);

export function exists(name) {
  return existsSync(file(name));
}

export function read(name, fallback) {
  try {
    return JSON.parse(readFileSync(file(name), "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

export function write(name, value) {
  const target = file(name);
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, target);
  return value;
}

/** Read, change, write. The callback may mutate the value or return a new one. */
export function update(name, fallback, change) {
  const current = read(name, fallback);
  const next = change(current) ?? current;
  write(name, next);
  return next;
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
