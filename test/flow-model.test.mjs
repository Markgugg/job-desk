import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowData } from '../src/lib/flow-model.mjs';

const app = (id, status = 'submitted', extra = {}) => ({
  company: 'Example', role: `Engineer ${id}`, url: `https://jobs.example.com/${id}`,
  submitted_at: '2026-01-01', status, ...extra
});
const event = (id, kind, extra = {}) => ({ url: `https://jobs.example.com/${id}`, kind, at: Date.parse('2026-02-01'), ...extra });
const count = (graph, id) => graph.nodes.find((node) => node.id === id)?.value ?? 0;

function conserved(graph) {
  for (const column of [0, 1, 2]) {
    assert.equal(graph.nodes.filter((node) => node.column === column).reduce((sum, node) => sum + node.value, 0), graph.total);
  }
  for (const node of graph.nodes) {
    if (node.column > 0) assert.equal(graph.links.filter((link) => link.target === node.id).reduce((sum, link) => sum + link.value, 0), node.value);
    if (node.column < 2) assert.equal(graph.links.filter((link) => link.source === node.id).reduce((sum, link) => sum + link.value, 0), node.value);
    assert.ok(node.value > 0);
    assert.ok(node.records.length <= 6);
  }
}

test('empty data produces no invented nodes or bands', () => {
  const data = buildFlowData();
  for (const graph of [data.applications, data.outreach]) {
    assert.equal(graph.total, 0);
    assert.deepEqual(graph.nodes, []);
    assert.deepEqual(graph.links, []);
    conserved(graph);
  }
});

test('full ledger is counted past the UI cap with bounded inspector samples', () => {
  const statuses = ['submitted', 'filled_awaiting_submit', 'rejected', 'skipped_transcript', 'error', 'blocked_custom_careers', 'unrecognized'];
  const rows = Array.from({ length: 1300 }, (_, i) => app(i, statuses[i % statuses.length]));
  const graph = buildFlowData({ applications: rows }).applications;
  assert.equal(graph.total, 1300);
  assert.ok(count(graph, 'not-submitted/other') > 0);
  conserved(graph);
});

test('deduplicates job URLs but preserves distinct query-based job IDs', () => {
  const graph = buildFlowData({ applications: [
    app(1, 'error'), app(1, 'submitted', { url: 'https://jobs.example.com/1?utm_source=email' }),
    app(2, 'submitted', { url: 'https://jobs.example.com/?job=1' }),
    app(3, 'submitted', { url: 'https://jobs.example.com/?job=2' })
  ] }).applications;
  assert.equal(graph.total, 3);
  assert.equal(count(graph, 'applied/waiting'), 3);
  conserved(graph);
});

test('uses latest linked eligible response without counting a role twice', () => {
  const data = buildFlowData({ applications: [app(1)], inbox: {
    actions: [event(1, 'assessment'), event(1, 'interview', { at: Date.parse('2026-03-01') })],
    rejections: [event(1, 'rejected', { at: Date.parse('2026-02-15') })]
  } });
  assert.equal(count(data.applications, 'applied/interview'), 1);
  assert.equal(count(data.applications, 'applied/rejected'), 0);
  assert.equal(data.unmatchedInbox, 0);
  conserved(data.applications);
});

test('does not link by company alone, ambiguous role, or mismatched explicit URL', () => {
  const data = buildFlowData({ applications: [app(1, 'submitted', { role: 'Engineer' }), app(2, 'submitted', { role: 'Engineer' })], inbox: {
    actions: [
      event(1, 'offer', { url: '', company: 'Example' }),
      event(1, 'offer', { url: '', company: 'Example', role: 'Engineer' }),
      event(90, 'offer', { company: 'Example', role: 'Engineer' })
    ]
  } });
  assert.equal(count(data.applications, 'applied/waiting'), 2);
  assert.equal(data.unmatchedInbox, 3);
});

test('allows an unambiguous company and role match', () => {
  const data = buildFlowData({ applications: [app(1)], inbox: {
    actions: [event(1, 'interview', { url: '', company: ' EXAMPLE ', role: 'engineer 1' })]
  } });
  assert.equal(count(data.applications, 'applied/interview'), 1);
});

test('ignores old and undated email, and preserves explicit terminal statuses', () => {
  const data = buildFlowData({ applications: [app(1), app(2), app(3, 'rejected'), app(4, 'filled_awaiting_submit')], inbox: {
    actions: [event(1, 'offer', { at: Date.parse('2025-01-01') }), event(2, 'offer', { at: undefined }), event(3, 'offer'), event(4, 'offer')]
  } });
  assert.equal(count(data.applications, 'applied/waiting'), 2);
  assert.equal(count(data.applications, 'applied/rejected'), 1);
  assert.equal(count(data.applications, 'preparing/ready'), 1);
  assert.equal(data.unmatchedInbox, 4);
  conserved(data.applications);
});

test('live forms appear in progress, including forms not saved to the ledger yet', () => {
  const graph = buildFlowData({ applications: [app(1, 'filled_awaiting_submit', { live: 'submitting' }), app(2, 'filling')] }).applications;
  assert.equal(count(graph, 'preparing/working'), 2);
  conserved(graph);
});

test('outreach records have separate conserved units and preserve unknown states', () => {
  const statuses = ['NEEDS_CONTACT', 'DRAFTED', 'NEEDS_REVIEW', 'APPROVED', 'SENT', 'FOLLOW_UP_NEEDED', 'REPLIED', 'POSITIVE_REPLY', 'REFERRAL_OFFERED', 'REFERRAL_RECEIVED', 'SKIPPED', 'NEW_STATUS'];
  const rows = statuses.map((status, id) => ({ id: String(id), company: 'Example', role: 'Engineer', job_id: 'same-job', status }));
  const data = buildFlowData({ applications: [app(1)], outreach: [...rows, rows[0]] });
  assert.equal(data.outreach.total, 12);
  assert.equal(data.applications.total, 1);
  assert.equal(count(data.outreach, 'other/unknown'), 1);
  assert.equal(count(data.outreach, 'sent/followup'), 1);
  conserved(data.outreach);
});

test('poll updates produce fresh totals without mutating source records', () => {
  const input = { applications: [app(1)], inbox: { actions: [event(1, 'offer')] } };
  const before = JSON.stringify(input);
  buildFlowData(input);
  assert.equal(JSON.stringify(input), before);
  input.applications.push(app(2, 'error'));
  const graph = buildFlowData(input).applications;
  assert.equal(graph.total, 2);
  assert.equal(count(graph, 'not-submitted/retry'), 1);
  conserved(graph);
});
