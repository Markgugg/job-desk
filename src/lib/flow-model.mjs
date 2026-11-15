// Shared by the tracker and the UI preview. Aggregate before the ledger's display cap.
const SAMPLE_LIMIT = 6;
const COLORS = {
  blue: '#7c9cf5', teal: '#57c7b2', amber: '#dfb56b', rose: '#dc8297',
  violet: '#ac94e8', gray: '#8b96a8', cyan: '#65bddc'
};

function text(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function jobKey(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(source|ref|referrer)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value).trim();
  }
}

function timestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Date.parse(value || '') || 0;
}

function uniqueApplications(rows) {
  const unique = new Map();
  for (const [index, row] of rows.entries()) {
    const key = jobKey(row.url) || `record-${index}`;
    const previous = unique.get(key);
    if (!previous || timestamp(row.submitted_at) >= timestamp(previous.submitted_at)) {
      unique.set(key, row);
    }
  }
  return [...unique.values()];
}

const APP_STAGES = [
  ['applied', 'Applied', COLORS.blue, [
    ['waiting', 'No linked outcome', COLORS.blue],
    ['assessment', 'Assessment', COLORS.cyan],
    ['interview', 'Interview', COLORS.violet],
    ['offer', 'Offer', COLORS.teal],
    ['followup', 'Reply / follow-up', COLORS.amber],
    ['rejected', 'Rejected', COLORS.rose],
    ['withdrawn', 'Withdrawn', COLORS.gray]
  ]],
  ['preparing', 'Preparing', COLORS.amber, [
    ['ready', 'Ready to submit', COLORS.amber],
    ['working', 'In progress', COLORS.cyan]
  ]],
  ['not-submitted', 'Not submitted', COLORS.gray, [
    ['blocked', 'Blocked / needs input', COLORS.violet],
    ['retry', 'Needs retry', COLORS.rose],
    ['skipped', 'Skipped', COLORS.gray],
    ['other', 'Other status', COLORS.gray]
  ]]
];

const OUTREACH_STAGES = [
  ['preparing', 'Preparing', COLORS.amber, [
    ['contact', 'Find a contact', COLORS.gray],
    ['draft', 'Drafted', COLORS.blue],
    ['review', 'Needs review', COLORS.amber],
    ['approved', 'Approved to send', COLORS.teal]
  ]],
  ['sent', 'Sent / connected', COLORS.blue, [
    ['waiting', 'Awaiting reply', COLORS.blue],
    ['followup', 'Follow-up due', COLORS.amber],
    ['reply', 'Replied', COLORS.cyan],
    ['positive', 'Positive reply', COLORS.violet],
    ['offered', 'Referral offered', COLORS.amber],
    ['received', 'Referral received', COLORS.teal]
  ]],
  ['other', 'Other', COLORS.gray, [
    ['skipped', 'Skipped', COLORS.gray],
    ['unknown', 'Other status', COLORS.gray]
  ]]
];

function graph(rows, stages, label, unit, classify) {
  const root = { id: 'root', label, column: 0, color: COLORS.blue, value: rows.length, records: [] };
  const nodes = [root];
  const links = [];
  const byId = new Map();
  for (const [id, name, color, leaves] of stages) {
    const parent = { id, label: name, column: 1, color, value: 0, records: [] };
    byId.set(id, parent);
    nodes.push(parent);
    for (const [leafId, leafLabel, leafColor] of leaves) {
      const leaf = { id: `${id}/${leafId}`, label: leafLabel, column: 2, color: leafColor, value: 0, records: [] };
      byId.set(leaf.id, leaf);
      nodes.push(leaf);
    }
  }
  for (const row of rows) {
    const id = classify(row);
    const leaf = byId.get(id);
    const parent = byId.get(id.split('/')[0]);
    const record = {
      company: row.company || 'Unknown company',
      role: row.contact?.full_name || row.role || 'Untitled role',
      url: row.url || row.job_id || '',
      status: String(row.status || 'Unknown').replaceAll('_', ' ')
    };
    for (const node of [root, parent, leaf]) {
      if (node !== root) node.value += 1;
      if (node.records.length < SAMPLE_LIMIT) node.records.push(record);
    }
  }
  const nonempty = nodes.filter((node) => node.value > 0);
  for (const node of nonempty) {
    if (!node.column) continue;
    links.push({ source: node.column === 1 ? 'root' : node.id.split('/')[0], target: node.id, value: node.value });
  }
  return { nodes: nonempty, links, total: rows.length, unit };
}

function applicationPosition(row, event) {
  const status = text(row.status);
  if (status === 'rejected') return 'applied/rejected';
  if (status === 'withdrawn') return 'applied/withdrawn';
  if (['offer', 'accepted', 'hired'].includes(status)) return 'applied/offer';
  if (['interview', 'interviewing'].includes(status)) return 'applied/interview';
  if (status === 'assessment') return 'applied/assessment';
  if (status === 'submitted') {
    const kind = event?.kind;
    if (['offer', 'interview', 'assessment', 'rejected'].includes(kind)) return `applied/${kind}`;
    if (kind === 'reply' || kind === 'form') return 'applied/followup';
    return 'applied/waiting';
  }
  if (row.live === 'filling' || row.live === 'submitting' || status === 'filling') return 'preparing/working';
  if (status === 'filled_awaiting_submit') return 'preparing/ready';
  if (/skip/.test(status)) return 'not-submitted/skipped';
  if (/error|retry/.test(status)) return 'not-submitted/retry';
  if (/block|needs_|captcha/.test(status)) return 'not-submitted/blocked';
  return 'not-submitted/other';
}

export function buildFlowData({ applications = [], inbox = {}, outreach = [] } = {}) {
  const apps = uniqueApplications(applications);
  const byUrl = new Map();
  const byRole = new Map();
  for (const row of apps) {
    const url = jobKey(row.url);
    if (url) byUrl.set(url, row);
    const roleKey = `${text(row.company)}|${text(row.role)}`;
    const matches = byRole.get(roleKey) || [];
    matches.push(row);
    byRole.set(roleKey, matches);
  }
  const latest = new Map();
  const seenEvents = new Set();
  let unmatchedInbox = 0;
  const events = [
    ...(inbox.actions || []),
    ...(inbox.rejections || []).map((event) => ({ ...event, kind: 'rejected' }))
  ].sort((a, b) => timestamp(a.at) - timestamp(b.at));
  for (const event of events) {
    if (!['offer', 'interview', 'assessment', 'reply', 'form', 'rejected'].includes(event.kind)) continue;
    const eventKey = event.uid || [event.url, event.company, event.role, event.kind, event.at, event.subject].join('|');
    if (seenEvents.has(eventKey)) continue;
    seenEvents.add(eventKey);
    // Company-only guesses can attach a rejection to the wrong job. Never use them.
    const key = jobKey(event.url);
    const candidates = event.company && event.role ? byRole.get(`${text(event.company)}|${text(event.role)}`) || [] : [];
    const app = key ? byUrl.get(key) : candidates.length === 1 ? candidates[0] : null;
    if (!app || !timestamp(event.at) || text(app.status) !== 'submitted' || timestamp(event.at) < timestamp(app.submitted_at)) {
      unmatchedInbox += 1;
      continue;
    }
    latest.set(app, event);
  }
  const outreachById = new Map();
  outreach.forEach((row, index) => outreachById.set(row.id || `record-${index}`, row));
  const outreachStatus = {
    NEEDS_CONTACT: 'preparing/contact', DRAFTED: 'preparing/draft', NEEDS_REVIEW: 'preparing/review',
    APPROVED: 'preparing/approved', SENT: 'sent/waiting', FOLLOW_UP_NEEDED: 'sent/followup', REPLIED: 'sent/reply', POSITIVE_REPLY: 'sent/positive',
    REFERRAL_OFFERED: 'sent/offered', REFERRAL_RECEIVED: 'sent/received', SKIPPED: 'other/skipped'
  };
  return {
    applications: graph(apps, APP_STAGES, 'Tracked roles', 'roles', (row) => applicationPosition(row, latest.get(row))),
    outreach: graph([...outreachById.values()], OUTREACH_STAGES, 'Outreach records', 'records', (row) => outreachStatus[String(row.status || '').toUpperCase()] || 'other/unknown'),
    unmatchedInbox
  };
}
