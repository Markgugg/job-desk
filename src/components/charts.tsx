// Charts, built on the bklit chart components. Every series comes from real
// tracker data; nothing is ever padded with sample points. When a series is
// empty the card says so, and the bklit loading state is used only for work
// that is genuinely in flight (a corpus scan, a tailor run).
import type { ReactNode } from "react";
import { AreaChart } from "@/components/charts/area-chart";
import { Area } from "@/components/charts/area";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { RingChart } from "@/components/charts/ring-chart";
import { Ring } from "@/components/charts/ring";
import { RingCenter } from "@/components/charts/ring-center";
import { ChartTooltip } from "@/components/charts/tooltip";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  ChartPie as PieIcon,
  Filter as FunnelIcon,
  ShieldCheck as ShieldIcon,
  TrendingUp as TrendIcon,
  type LucideIcon
} from "lucide-react";

export function ChartFrame({
  title,
  description,
  icon: Icon,
  empty,
  emptyNote,
  emptyAction,
  action,
  footer,
  children
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  empty: boolean;
  emptyNote: string;
  emptyAction?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1"><CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription></div>
        {action ? <CardAction className="self-start">{action}</CardAction> : null}
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex min-h-[220px] flex-col items-start justify-center gap-1.5 rounded-lg border border-dashed p-6 text-sm">
            <span className="bg-muted text-muted-foreground mb-1 flex size-9 items-center justify-center rounded-lg">
              <Icon className="size-4.5" aria-hidden />
            </span>
            <p className="text-foreground font-medium">Nothing to plot yet</p>
            <p className="text-muted-foreground max-w-prose">{emptyNote}</p>
            {emptyAction ? <div className="mt-2">{emptyAction}</div> : null}
          </div>
        ) : (
          <div className="overflow-x-auto">{children}</div>
        )}
      </CardContent>
      {footer ? <CardFooter className="text-muted-foreground text-xs">{footer}</CardFooter> : null}
    </Card>
  );
}

const AREA_MARGIN = { top: 20, right: 34, bottom: 32, left: 38 };
const BAR_MARGIN = { top: 20, right: 24, bottom: 32, left: 38 };
const H_BAR_MARGIN = { top: 16, right: 32, bottom: 32, left: 128 };

const PLOT = "h-[280px] w-full min-w-0";
const PLOT_SHORT = "h-[260px] w-full min-w-0";

/** Applications submitted per day. */
export function SubmittedOverTime({
  data,
  loading = false,
  action,
  footer
}: {
  data: { date: string; label: string; submitted: number; bucketing?: string }[];
  loading?: boolean;
  action?: ReactNode;
  footer?: ReactNode;
}) {
  const bucketing = data[0]?.bucketing ?? "day";
  return (
    <ChartFrame
      icon={TrendIcon}
      title="Submitted over time"
      description={`Applications submitted per ${bucketing}`}
      empty={!loading && !data.length}
      emptyNote="No submitted applications yet. This fills in as the agent submits."
      action={action}
      footer={footer}
    >
      <AreaChart
        data={data}
        xDataKey="date"
        margin={AREA_MARGIN}
        className={PLOT}
        status={loading ? "loading" : "ready"}
        loadingLabel={loading ? "Reading the ledger" : undefined}
      >
        <Grid />
        <XAxis />
        <Area
          dataKey="submitted"
          fill="var(--primary)"
          stroke="var(--primary)"
          fillOpacity={0.25}
          gradientToOpacity={0.05}
        />
        <ChartTooltip />
      </AreaChart>
    </ChartFrame>
  );
}

/** Submitted against rejections, both from real records. */
export function OutcomesOverTime({
  data
}: {
  data: { date: string; label: string; submitted: number; rejected: number; bucketing?: string }[];
}) {
  const rejections = data.reduce((sum, row) => sum + row.rejected, 0);
  const bucketing = data[0]?.bucketing ?? "day";
  return (
    <ChartFrame
      icon={TrendIcon}
      title="Outcomes over time"
      description={`Submitted against employer rejections, per ${bucketing}`}
      empty={!data.length}
      emptyNote="Nothing submitted and nothing rejected yet."
      footer={
        rejections === 0 ? "No rejection emails recorded yet — the rejected series stays flat at zero." : undefined
      }
    >
      <AreaChart data={data} xDataKey="date" margin={AREA_MARGIN} className={PLOT}>
        <Grid />
        <XAxis />
        <Area
          dataKey="submitted"
          fill="var(--chart-2)"
          stroke="var(--chart-2)"
          fillOpacity={0.4}
          gradientToOpacity={0.05}
        />
        <Area
          dataKey="rejected"
          fill="var(--destructive)"
          stroke="var(--destructive)"
          fillOpacity={0.35}
          gradientToOpacity={0.05}
        />
        <ChartTooltip />
      </AreaChart>
    </ChartFrame>
  );
}

/** A proportional donut; its legend also exposes every value as text. */
export function PipelineRings({
  data
}: {
  data: { label: string; value: number; maxValue: number; color?: string }[];
}) {
  const total = data.reduce((sum, row) => sum + row.value, 0);
  let offset = 0;
  return (
    <ChartFrame
      icon={PieIcon}
      title="Pipeline status"
      description="Where every tracked role stands"
      empty={!data.length}
      emptyNote="Nothing in the pipeline yet."
    >
      <div className="flex min-h-[280px] flex-wrap items-center justify-center gap-6">
        <div className="relative size-[200px] shrink-0">
          <svg viewBox="0 0 200 200" className="size-full -rotate-90" role="img" aria-label={`${total} tracked applications. ${data.map((row) => `${row.label}: ${row.value}`).join(', ')}`}>
            {data.map((row) => {
              const share = total ? row.value / total * 100 : 0;
              const start = offset;
              offset += share;
              return <circle key={row.label} cx="100" cy="100" r="78" fill="none" stroke={row.color} strokeWidth="28" pathLength="100" strokeDasharray={`${Math.max(0, share - 0.8)} ${100 - Math.max(0, share - 0.8)}`} strokeDashoffset={-start}><title>{row.label}: {row.value}</title></circle>;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-semibold tabular-nums">{total}</span>
            <span className="text-muted-foreground mt-1 text-xs">Tracked roles</span>
          </div>
        </div>
        <ul className="min-w-[145px] flex-1 space-y-3 text-sm">
          {data.map((row) => (
            <li key={row.label} className="flex items-center gap-2">
              <span className="size-2.5 rounded-[3px]" style={{ background: row.color }} aria-hidden />
              <span className="text-muted-foreground">{row.label}</span>
              <span className="ml-auto text-right font-semibold tabular-nums">{row.value}<span className="text-muted-foreground block text-xs font-normal">{total ? Math.round(row.value / total * 100) : 0}%</span></span>
            </li>
          ))}
          <li className="flex items-center gap-2 border-t pt-1.5">
            <span className="text-muted-foreground">Total</span>
            <span className="ml-auto font-semibold tabular-nums">{total}</span>
          </li>
        </ul>
      </div>
    </ChartFrame>
  );
}

/** Generic horizontal bar: one categorical row per record. */
export function HorizontalBars({
  data,
  dataKey,
  title,
  description,
  icon,
  emptyNote,
  fill = "var(--chart-1)",
  loading = false,
  footer,
  emptyAction
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  title: string;
  description: string;
  icon: LucideIcon;
  emptyNote: string;
  fill?: string;
  loading?: boolean;
  footer?: ReactNode;
  emptyAction?: ReactNode;
}) {
  return (
    <ChartFrame
      icon={icon}
      title={title}
      description={description}
      empty={!loading && !data.length}
      emptyNote={emptyNote}
      emptyAction={emptyAction}
      footer={footer}
    >
      <BarChart
        data={data}
        xDataKey="name"
        orientation="horizontal"
        margin={H_BAR_MARGIN}
        className={PLOT}
        status={loading ? "loading" : "ready"}
      >
        <Grid vertical horizontal={false} />
        <BarYAxis />
        <Bar dataKey={dataKey} fill={fill} />
      </BarChart>
    </ChartFrame>
  );
}

/** Generic vertical bar, optionally stacked for two series. */
export function VerticalBars({
  data,
  series,
  title,
  description,
  icon,
  emptyNote,
  stacked = false,
  loading = false,
  footer,
  emptyAction
}: {
  data: Record<string, unknown>[];
  series: { dataKey: string; fill: string }[];
  title: string;
  description: string;
  icon: LucideIcon;
  emptyNote: string;
  stacked?: boolean;
  loading?: boolean;
  footer?: ReactNode;
  emptyAction?: ReactNode;
}) {
  return (
    <ChartFrame
      icon={icon}
      title={title}
      description={description}
      empty={!loading && !data.length}
      emptyNote={emptyNote}
      emptyAction={emptyAction}
      footer={footer}
    >
      <BarChart
        data={data}
        xDataKey="name"
        margin={BAR_MARGIN}
        stacked={stacked}
        className={PLOT_SHORT}
        status={loading ? "loading" : "ready"}
      >
        <Grid />
        <BarXAxis maxLabels={10} />
        {series.map((s) => (
          <Bar key={s.dataKey} dataKey={s.dataKey} fill={s.fill} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

/** Outreach ladder as a real funnel. */
export function OutreachLadder({
  data,
  footer
}: {
  data: { label: string; value: number; color?: string }[];
  footer?: ReactNode;
}) {
  return (
    <ChartFrame
      icon={FunnelIcon}
      title="Outreach funnel"
      description="Every stage of the real status ladder"
      empty={!data.length}
      emptyNote="No outreach recorded yet. Prepare a batch and add real people to start the funnel."
      footer={footer}
    >
      <FunnelChart
        data={data.map((stage) => ({ label: stage.label, value: stage.value, color: stage.color }))}
        orientation="horizontal"
        className="min-h-[300px] min-w-[320px]"
        showValues
        showLabels
        showPercentage={false}
      />
    </ChartFrame>
  );
}

/** Verified vs stated evidence as rings. */
export function ConfidenceRings({
  data
}: {
  data: { label: string; value: number; maxValue: number; color?: string }[];
}) {
  const verified = data.find((row) => row.label === "Verified")?.value ?? 0;
  const total = data.reduce((sum, row) => sum + row.value, 0);
  return (
    <ChartFrame
      icon={ShieldIcon}
      title="Verified vs stated"
      description="How much of the store is safe to claim"
      empty={!data.length}
      emptyNote="No evidence extracted yet. Add a source and run a scan."
      footer={
        total
          ? `${verified} of ${total} items are computed from files or git history; the rest are only stated in notes.`
          : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-6">
        <RingChart data={data} className="h-[200px] w-[200px] min-w-[200px]" strokeWidth={14} baseInnerRadius={46}>
          {data.map((row, index) => (
            <Ring key={row.label} index={index} color={row.color} />
          ))}
          <RingCenter defaultLabel="facts" />
        </RingChart>
        <ul className="min-w-[150px] flex-1 space-y-1.5 text-sm">
          {data.map((row) => (
            <li key={row.label} className="flex items-center gap-2">
              <span className="size-2.5 rounded-[3px]" style={{ background: row.color }} aria-hidden />
              <span className="text-muted-foreground">{row.label}</span>
              <span className="ml-auto font-semibold tabular-nums">{row.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  );
}
