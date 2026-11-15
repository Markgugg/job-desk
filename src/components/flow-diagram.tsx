import { useId, useMemo, useState } from "react";
import type { FlowGraph, FlowNode } from "@/lib/flow-model.mjs";

interface PositionedNode extends FlowNode {
  x: number;
  y: number;
  height: number;
}

function layout(graph: FlowGraph) {
  const leaves = graph.nodes.filter((node) => node.column === 2);
  const height = Math.max(500, leaves.length * 48 + 120);
  const top = 88;
  const bottom = 32;
  const gap = 34;
  const scale = (height - top - bottom - Math.max(0, leaves.length - 1) * gap) / Math.max(1, graph.total);
  const positions = new Map<string, PositionedNode>();
  let y = top;
  for (const node of leaves) {
    positions.set(node.id, { ...node, x: 800, y, height: node.value * scale });
    y += node.value * scale + gap;
  }
  for (const node of graph.nodes.filter((item) => item.column === 1)) {
    const children = leaves.filter((leaf) => leaf.id.startsWith(`${node.id}/`));
    const first = positions.get(children[0].id)!;
    const last = positions.get(children[children.length - 1].id)!;
    const height = node.value * scale;
    positions.set(node.id, { ...node, x: 410, y: (first.y + last.y + last.height - height) / 2, height });
  }
  const root = graph.nodes.find((node) => node.column === 0);
  if (root) positions.set(root.id, { ...root, x: 32, y: top + (height - top - bottom - root.value * scale) / 2, height: root.value * scale });
  const offsets = new Map<string, number>();
  const links = graph.links.map((link) => {
    const source = positions.get(link.source)!;
    const target = positions.get(link.target)!;
    const start = source.y + (offsets.get(source.id) || 0);
    const thickness = link.value * scale;
    offsets.set(source.id, (offsets.get(source.id) || 0) + thickness);
    const x1 = source.x + 10;
    const x2 = target.x;
    const bend = (x2 - x1) * 0.48;
    const path = `M${x1},${start} C${x1 + bend},${start} ${x2 - bend},${target.y} ${x2},${target.y} L${x2},${target.y + thickness} C${x2 - bend},${target.y + thickness} ${x1 + bend},${start + thickness} ${x1},${start + thickness} Z`;
    return { ...link, source, target, path };
  });
  return { nodes: [...positions.values()], links, height };
}

function related(nodeId: string, focus: string | null) {
  return !focus || focus === "root" || nodeId === "root" || nodeId === focus ||
    nodeId.startsWith(`${focus}/`) || focus.startsWith(`${nodeId}/`);
}

export function FlowDiagram({ graph, selected, onSelect, svgRef }: {
  graph: FlowGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  svgRef: React.Ref<SVGSVGElement>;
}) {
  const id = useId().replaceAll(":", "");
  const [hovered, setHovered] = useState<string | null>(null);
  const drawing = useMemo(() => layout(graph), [graph]);
  const focus = hovered ?? selected;
  const toggle = (node: string) => onSelect(selected === node ? null : node);

  return (
    <svg ref={svgRef} viewBox={`0 0 1120 ${drawing.height}`} className="block w-full min-w-[920px]"
      role="group" aria-label={`${graph.total} ${graph.unit} in the live flow. Select a stage or connection to inspect its records.`}
      fontFamily="Inter, system-ui, sans-serif">
      <title>{graph.total} {graph.unit} · Job Desk flow</title>
      <desc>Each record follows one path from the total, through its progress group, to its current position. Band width represents the number of records.</desc>
      <defs>
        {drawing.links.map((link, index) => (
          <linearGradient key={index} id={`${id}-ribbon-${index}`} gradientUnits="userSpaceOnUse" x1={link.source.x} x2={link.target.x}>
            <stop offset="0%" stopColor={link.source.color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={link.target.color} stopOpacity="0.48" />
          </linearGradient>
        ))}
      </defs>
      <rect width="1120" height={drawing.height} fill="var(--card)" rx="12" />
      {[{ x: 32, label: "01 / PIPELINE" }, { x: 410, label: "02 / PROGRESS" }, { x: 800, label: "03 / CURRENT POSITION" }].map((column) => (
        <g key={column.x} aria-hidden="true">
          <text x={column.x} y="24" fill="var(--muted-foreground)" fontSize="10" fontWeight="500" letterSpacing="1.5">{column.label}</text>
          <line x1={column.x} x2={column.x + 265} y1="40" y2="40" stroke="var(--border)" />
        </g>
      ))}
      {drawing.links.map((link, index) => {
        const active = related(link.target.id, focus);
        return (
          <path key={`${link.source.id}-${link.target.id}`} d={link.path} fill={`url(#${id}-ribbon-${index})`}
            stroke={link.target.color} strokeWidth="0.5" strokeOpacity="0.25"
            style={{ opacity: active ? 1 : 0.12, transition: "opacity 180ms ease", cursor: "pointer" }}
            role="button" tabIndex={0} aria-label={`${link.source.label} to ${link.target.label}: ${link.value} ${graph.unit}`}
            aria-pressed={selected === link.target.id}
            onMouseEnter={() => setHovered(link.target.id)} onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(link.target.id)} onBlur={() => setHovered(null)}
            onClick={() => toggle(link.target.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(link.target.id); }
              if (event.key === "Escape") { setHovered(null); onSelect(null); }
            }}>
            <title>{link.source.label} → {link.target.label}: {link.value} ({Math.round(link.value / graph.total * 100)}%)</title>
          </path>
        );
      })}
      {drawing.nodes.map((node) => {
        const terminal = node.column === 2;
        const active = related(node.id, focus);
        return (
          <g key={node.id} role="button" tabIndex={0} aria-label={`${node.label}: ${node.value} ${graph.unit}`}
            aria-pressed={selected === node.id} style={{ opacity: active ? 1 : 0.3, transition: "opacity 180ms ease", cursor: "pointer" }}
            onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(node.id)} onBlur={() => setHovered(null)} onClick={() => toggle(node.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(node.id); }
              if (event.key === "Escape") { setHovered(null); onSelect(null); }
            }}>
            <rect x={node.x - 4} y={node.y - 8} width={terminal ? 280 : 24} height={Math.max(24, node.height + 16)} fill="transparent" />
            <rect x={node.x} y={node.y} width="10" height={node.height} rx={Math.min(3, node.height / 2)} fill={node.color} />
            {terminal ? (
              <>
                <text x={node.x + 24} y={node.y + node.height / 2 - 1} fill="var(--foreground)" fontSize="12" fontWeight="500">{node.label}</text>
                <text x={node.x + 24} y={node.y + node.height / 2 + 14} fill="var(--muted-foreground)" fontSize="10">{(node.value / graph.total * 100).toFixed(1)}% of {graph.unit}</text>
                <text x="1088" y={node.y + node.height / 2 + 5} textAnchor="end" fill="var(--foreground)" fontSize="16" fontWeight="600" style={{ fontVariantNumeric: "tabular-nums" }}>{node.value.toLocaleString()}</text>
              </>
            ) : (
              <text x={node.x} y={node.y - 15} fill="var(--foreground)" fontSize="13" fontWeight="500">
                {node.label}<tspan fill="var(--muted-foreground)"> · {node.value.toLocaleString()}</tspan>
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
