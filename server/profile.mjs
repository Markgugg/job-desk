// Candidate profile: a fixed schema the Profile tab renders as a form, plus the
// list of fields that still need a value.
import { createHash } from "node:crypto";
import { read, write } from "./store.mjs";

const text = (key, label) => ({ key, label, type: "text", nullable: false });
const area = (key, label) => ({ key, label, type: "textarea", nullable: false });
const list = (key, label) => ({ key, label, type: "list", nullable: false });
const yesNo = (key, label) => ({ key, label, type: "boolean", nullable: true });
const amount = (key, label) => ({ key, label, type: "number", nullable: true });
const group = (key, label, fields) => ({ key, label, type: "group", nullable: false, fields });

export const FIELDS = [
  group("personal", "Contact details", [
    text("first_name", "First name"),
    text("last_name", "Last name"),
    text("email", "Email"),
    text("phone", "Phone"),
    text("city", "City"),
    text("region", "State / region"),
    text("country", "Country"),
    text("phone_country_code", "Phone country code"),
    text("nationality", "Nationality"),
    yesNo("open_to_relocation", "Open to relocation")
  ]),
  group("links", "Links", [text("linkedin", "LinkedIn"), text("github", "GitHub"), text("portfolio", "Portfolio")]),
  group("education", "Education", [
    text("school", "School"),
    text("degree", "Degree"),
    text("major", "Major"),
    text("graduation", "Graduation (month and year)"),
    amount("start_year", "Start year"),
    amount("gpa", "GPA"),
    list("coursework", "Relevant coursework")
  ]),
  group("eligibility", "Employment eligibility", [
    yesNo("authorized", "Authorized to work in the country of the job"),
    yesNo("needs_sponsorship", "Will need visa sponsorship")
  ]),
  group("preferences", "Job preferences", [
    list("roles", "Target roles"),
    list("locations", "Preferred locations"),
    yesNo("remote", "Open to remote"),
    amount("minimum_salary", "Minimum base salary")
  ]),
  {
    key: "experience",
    label: "Experience",
    type: "records",
    nullable: false,
    fields: [text("company", "Company"), text("title", "Title"), text("start", "Start"), text("end", "End"), area("summary", "What you did")]
  },
  area("summary", "Short bio")
];

export const REQUIRED = [
  "personal.first_name",
  "personal.last_name",
  "personal.email",
  "personal.phone",
  "education.school",
  "education.degree",
  "education.graduation"
];

function empty(field) {
  if (field.type === "group") return Object.fromEntries(field.fields.map((f) => [f.key, empty(f)]));
  if (field.type === "records" || field.type === "list") return [];
  if (field.nullable) return null;
  return "";
}

/** Force any input into the schema's shape: unknown keys dropped, types coerced. */
function conform(field, value) {
  switch (field.type) {
    case "group": {
      const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      return Object.fromEntries(field.fields.map((f) => [f.key, conform(f, source[f.key])]));
    }
    case "records":
      return (Array.isArray(value) ? value : []).slice(0, 50).map((row) =>
        Object.fromEntries(field.fields.map((f) => [f.key, conform(f, row?.[f.key])]))
      );
    case "list":
      return (Array.isArray(value) ? value : String(value ?? "").split("\n"))
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 100);
    case "boolean":
      return value === true || value === false ? value : null;
    case "number": {
      if (value === null || value === undefined || value === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return String(value ?? "").slice(0, 4000);
  }
}

export function blankProfile() {
  return Object.fromEntries(FIELDS.map((f) => [f.key, empty(f)]));
}

export function loadProfile() {
  const stored = read("profile", blankProfile());
  return Object.fromEntries(FIELDS.map((f) => [f.key, conform(f, stored[f.key])]));
}

function revisionOf(profile) {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex").slice(0, 16);
}

export function editableProfile() {
  const profile = loadProfile();
  return { profile, revision: revisionOf(profile), fields: FIELDS };
}

export function missingFields(profile = loadProfile()) {
  return REQUIRED.filter((path) => {
    const value = path.split(".").reduce((node, key) => node?.[key], profile);
    return value === null || value === undefined || String(value).trim() === "";
  });
}

export function saveProfile(body) {
  const current = editableProfile();
  if (!body || typeof body.profile !== "object") throw Object.assign(new Error("Send a profile object."), { status: 400 });
  if (body.revision !== current.revision) {
    throw Object.assign(new Error("The saved profile changed after you opened it. Reload it and make your edits again."), { status: 409 });
  }
  const next = Object.fromEntries(FIELDS.map((f) => [f.key, conform(f, body.profile[f.key])]));
  const email = next.personal.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("That email address does not look right."), { status: 400 });
  }
  write("profile", next);
  return editableProfile();
}
