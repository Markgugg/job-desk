// App shell: fixed sidebar, topbar with collapse + appearance toggle.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "cn";
import {
  Database,
  FileUser,
  Monitor,
  Moon,
  PanelLeft,
  Send,
  Settings,
  Sun,
  CircleCheck,
  TriangleAlert,
  Users,
  GitBranch,
  Briefcase,
  type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme";
import type { TrackerState } from "@/lib/api";
import { formatClock } from "@/lib/format";

export type SectionKey = "applications" | "flow" | "outreach" | "resume" | "database" | "setup" | "automations";

export const SECTIONS: {
  key: SectionKey;
  label: string;
  group: "Prepare" | "Run" | "Review";
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  { key: "automations", label: "Jobs", group: "Run", icon: Briefcase, title: "Jobs", description: "Add jobs to track, review matched postings, and refresh your evidence." },
  {
    key: "applications",
    label: "Applications",
    group: "Review",
    icon: Send,
    title: "Applications",
    description: "Track your job search, review ready applications, and keep the next step in sight."
  },
  {
    key: "outreach",
    label: "Outreach",
    group: "Review",
    icon: Users,
    title: "Outreach",
    description: "People, messages and referrals, one conversation at a time."
  },
  {
    key: "flow",
    label: "Progress",
    group: "Review",
    icon: GitBranch,
    title: "Progress",
    description: "Every opportunity, connected. Follow your job search from preparation to outcome."
  },
  {
    key: "resume",
    label: "Resume",
    group: "Prepare",
    icon: FileUser,
    title: "Resume",
    description: "Keep your base resume here and see how its keywords cover each job."
  },
  {
    key: "database",
    label: "Evidence",
    group: "Prepare",
    icon: Database,
    title: "Evidence",
    description: "Connect your repositories and notes to support the claims in your resume."
  },
  {
    key: "setup",
    label: "Profile",
    group: "Prepare",
    icon: Settings,
    title: "Profile",
    description: "Your background and contact details. Save what you know; finish the rest when you need it."
  }
];

function AgentStatus({ state, offline }: { state: TrackerState | null; offline: boolean }) {
  const tone = offline ? "offline" : state?.agent || "idle";
  const dot =
    tone === "offline"
      ? "bg-destructive"
      : tone === "ready" || tone === "working"
        ? "bg-[var(--ok)]"
        : "bg-[var(--warn)]";
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span className={cn("size-2 shrink-0 rounded-full", dot, tone === "working" && "animate-pulse")} />
      <div className="min-w-0">
        <p className="leading-tight font-medium">
          {offline ? "Server not reachable" : state?.agentLabel || "Checking…"}
        </p>
        <p className="text-muted-foreground hidden truncate text-xs leading-tight sm:block">
          {offline ? "Run npm start, then reload" : state?.agentDetail || "Connecting…"}
        </p>
      </div>
    </div>
  );
}

function AppearanceButton() {
  const { mode, next } = useTheme();
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={next}
      title={`Appearance: ${mode} — click to change`}
      aria-label={`Appearance: ${mode}. Click to change.`}
    >
      <Icon className="size-4" />
    </Button>
  );
}

export function Shell({
  preview = false,
  active,
  onNavigate,
  state,
  offline,
  badges,
  banner,
  children
}: {
  active: SectionKey;
  onNavigate: (key: SectionKey) => void;
  state: TrackerState | null;
  offline: boolean;
  preview?: boolean;
  badges: Partial<Record<SectionKey, string | number>>;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => !window.matchMedia("(max-width: 767px)").matches);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 767px)");
    const onResize = () => setOpen(!mobile.matches);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && mobile.matches) setOpen(false);
    };
    mobile.addEventListener("change", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      mobile.removeEventListener("change", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const groups: ("Prepare" | "Run" | "Review")[] = ["Prepare", "Run", "Review"];
  const profileReady = state?.setup?.complete === true;
  const missingCount = state?.setup?.missing?.length ?? 0;

  return (
    <div className="bg-background min-h-svh">
      <a
        href="#main"
        className="bg-popover focus:ring-ring sr-only rounded-md border px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          "bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
            <Send className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold tracking-tight">Job Desk</p>
            <p className="text-muted-foreground truncate text-xs">Your next opportunity</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Sections">
          {groups.map((group) => (
            <div key={group} className="mb-5">
              <p className="text-muted-foreground px-2.5 pb-2 text-xs font-medium">
                {group}
              </p>
              <ul className="space-y-0.5">
                {SECTIONS.filter((s) => s.group === group).sort((a, b) => group === "Prepare" ? ["setup", "resume", "database"].indexOf(a.key) - ["setup", "resume", "database"].indexOf(b.key) : 0).map((section) => {
                  const on = section.key === active;
                  const badge = badges[section.key];
                  const Icon = section.icon;
                  return (
                    <li key={section.key}>
                      <a
                        href={`#${section.key}`}
                        aria-current={on ? "page" : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          onNavigate(section.key);
                          if (window.matchMedia("(max-width: 767px)").matches) setOpen(false);
                        }}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md px-2.5 py-2.5 text-sm transition-colors",
                          on
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground font-medium"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="size-4 shrink-0" aria-hidden />
                          {section.label}
                        </span>
                        {badge ? (
                          <span className="bg-background text-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold tabular-nums">
                            {badge}
                          </span>
                        ) : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mx-3 mb-4 rounded-lg border p-3">
          <p className="text-sm font-medium">Everything stays local</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">Your data lives in the data folder on this computer. Nothing is sent anywhere.</p>
        </div>
        <button type="button" onClick={() => { onNavigate("setup"); if (window.matchMedia("(max-width: 767px)").matches) setOpen(false); }} className="border-t px-4 py-4 text-left hover:bg-sidebar-accent">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-md",
                profileReady ? "bg-[color-mix(in_oklab,var(--ok)_16%,transparent)]" : "bg-muted"
              )}
            >
              {profileReady ? (
                <CircleCheck className="size-4 text-[var(--ok)]" aria-hidden />
              ) : (
                <Settings className="text-muted-foreground size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">
                {profileReady ? "Profile ready" : missingCount ? `${missingCount} field${missingCount === 1 ? "" : "s"} to fill` : "Profile"}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {state ? `Updated ${formatClock(state.generatedAt)}` : "Not connected"} · local only
              </p>
            </div>
          </div>
        </button>
      </aside>

      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
        />
      ) : null}

      <div className={cn("transition-[padding] duration-200 ease-out", open ? "md:pl-64" : "pl-0")}>
        <header className="bg-background sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
          >
            <PanelLeft className="size-4" />
          </Button>
          <span className="bg-border h-4 w-px" />
          <span className="text-sm font-medium">{SECTIONS.find((s) => s.key === active)?.title}</span>
          <div className="ml-auto flex items-center gap-4">
            <div className="hidden sm:block"><AgentStatus state={state} offline={offline} /></div>
            <AppearanceButton />
          </div>
        </header>

      {preview ? (
        <div className="bg-destructive flex flex-wrap items-center justify-center gap-2 px-4 py-2 text-center text-sm font-semibold text-white">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          <span>
            SAMPLE DATA — design preview only. Remove
            <code className="mx-1 rounded bg-black/25 px-1 py-0.5 font-mono text-xs">?preview=1</code>
            from the URL to return to your actual dashboard.
          </span>
        </div>
      ) : null}

        {banner}

        <main id="main" className="mx-auto w-full max-w-[1600px] px-4 py-6 lg:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
