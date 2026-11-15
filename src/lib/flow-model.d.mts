import type { Application, InboxRow, OutreachRow } from './api';

export interface FlowRecord {
  company: string;
  role: string;
  url: string;
  status: string;
}
export interface FlowNode {
  id: string;
  label: string;
  column: number;
  color: string;
  value: number;
  records: FlowRecord[];
}
export interface FlowLink {
  source: string;
  target: string;
  value: number;
}
export interface FlowGraph {
  nodes: FlowNode[];
  links: FlowLink[];
  total: number;
  unit: string;
}
export interface FlowData {
  applications: FlowGraph;
  outreach: FlowGraph;
  unmatchedInbox: number;
}
export function buildFlowData(input?: {
  applications?: Application[];
  inbox?: { actions?: InboxRow[]; rejections?: InboxRow[] };
  outreach?: OutreachRow[];
}): FlowData;
