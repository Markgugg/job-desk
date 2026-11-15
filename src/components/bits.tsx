// Small shared pieces: cards, rows, badges, empty and error states.
import type { ReactNode } from "react";
import { cn } from "cn";
import { AlertTriangle, Inbox, Info, type LucideIcon } from "lucide-react";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { bucket } from "@/lib/format";

/** Reference card treatment: a faint primary gradient and an xs shadow. */
export const CARD_SURFACE =
  "*:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card";

export function PageHead({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{description}</p>
    </div>
  );
}

export function SectionHead({
  title,
  note,
  action,
  icon: Icon
}: {
  title: string;
  note?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          {Icon ? <Icon className="text-muted-foreground size-4" aria-hidden /> : null}
          {title}
        </h2>
        {note ? <p className="text-muted-foreground mt-1 text-sm">{note}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  lead,
  note,
  icon: Icon,
  leadIcon: LeadIcon,
  action
}: {
  label: string;
  value: ReactNode;
  lead?: string;
  note?: string;
  icon?: LucideIcon;
  leadIcon?: LucideIcon;
  action?: ReactNode;
}) {
  // The label line stays clean and the icon trails the lead sentence instead,
  // which is where the reference design puts it.
  const FootIcon = LeadIcon ?? Icon;
  return (
    <Card className="@container/card from-primary/5 to-card h-full bg-gradient-to-t">
      <CardHeader>
        <CardDescription className="text-sm">{label}</CardDescription>
        <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </CardTitle>
        {action || Icon ? <CardAction>{action ?? (Icon ? <span className="text-muted-foreground flex size-7 items-center justify-center rounded-md border"><Icon className="size-3.5" aria-hidden /></span> : null)}</CardAction> : null}
      </CardHeader>
      {lead || note ? (
        // No divider and no tinted bar: the footer sits flush on the card
        // surface, matching the reference.
        <CardFooter className="mt-auto flex-col items-start gap-1 border-t-0 bg-transparent pt-0 text-sm">
          {lead ? (
            <p className="flex items-center gap-1.5 font-medium">
              {lead}
              {FootIcon ? <FootIcon className="size-4" aria-hidden /> : null}
            </p>
          ) : null}
          {note ? <p className="text-muted-foreground">{note}</p> : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function EmptyState({
  title,
  note,
  action,
  className,
  icon: Icon = Inbox
}: {
  title: string;
  note: string;
  action?: ReactNode;
  className?: string;
  icon?: LucideIcon;
}) {
  return (
    <div
      className={cn(
        "bg-card ring-foreground/10 to-card from-primary/5 flex flex-col items-start gap-1.5 rounded-xl bg-gradient-to-t p-8 text-sm shadow-xs ring-1 dark:bg-card",
        className
      )}
    >
      <span className="bg-muted text-muted-foreground mb-1 flex size-9 items-center justify-center rounded-lg">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <strong className="text-foreground text-sm font-semibold">{title}</strong>
      <span className="text-muted-foreground max-w-prose">{note}</span>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Notice({
  children,
  tone = "default"
}: {
  children: ReactNode;
  tone?: "default" | "bad";
}) {
  const Icon = tone === "bad" ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm",
        tone === "bad"
          ? "bg-[color-mix(in_oklab,var(--destructive)_8%,var(--card))]"
          : "bg-card"
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon
          className={cn("mt-0.5 size-4 shrink-0", tone === "bad" ? "text-destructive" : "text-muted-foreground")}
          aria-hidden
        />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

const TONES: Record<string, string> = {
  submitted: "border-[color-mix(in_oklab,var(--ok)_30%,transparent)] bg-[color-mix(in_oklab,var(--ok)_14%,transparent)] text-[var(--ok)]",
  waiting: "border-[color-mix(in_oklab,var(--warn)_30%,transparent)] bg-[color-mix(in_oklab,var(--warn)_14%,transparent)] text-[var(--warn)]",
  blocked: "border-[color-mix(in_oklab,var(--info)_30%,transparent)] bg-[color-mix(in_oklab,var(--info)_14%,transparent)] text-[var(--info)]",
  rejected: "border-[color-mix(in_oklab,var(--destructive)_30%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] text-destructive",
  neutral: "bg-muted text-muted-foreground"
};

export type StatusTone = keyof typeof TONES;

export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone] ?? TONES.neutral
      )}
    >
      {children}
    </span>
  );
}

export function toneForStatus(status?: string, live?: string | null): StatusTone {
  if (live === "filling" || live === "submitting") return "waiting";
  return bucket(status);
}

export function toneForOutreach(status?: string): StatusTone {
  const s = String(status || "").toUpperCase();
  if (["APPROVED", "SENT", "REPLIED", "POSITIVE_REPLY", "REFERRAL_RECEIVED"].includes(s)) return "submitted";
  if (["NEEDS_REVIEW"].includes(s)) return "waiting";
  if (["NEEDS_CONTACT", "REFERRAL_OFFERED"].includes(s)) return "blocked";
  if (["SKIPPED"].includes(s)) return "rejected";
  return "neutral";
}

export function DataList({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <div className="bg-card ring-foreground/10 min-w-full divide-y rounded-xl ring-1">{children}</div>
    </div>
  );
}

export function DataRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "hover:bg-accent/60 grid grid-cols-1 items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors sm:grid-cols-[minmax(120px,1.1fr)_minmax(140px,1.6fr)_auto_auto_auto_auto]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function ExternalLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
      {children}
    </a>
  );
}
