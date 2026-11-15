import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { ThemeProvider } from "@/components/theme";
import { Shell, SECTIONS, type SectionKey } from "@/components/shell";
import { PageHead } from "@/components/bits";
import { ApplicationsPage } from "@/pages/applications";
import { getState, type TrackerState } from "@/lib/api";
import { isPreview, previewState } from "@/lib/preview";

const OutreachPage = lazy(() => import("@/pages/outreach").then((module) => ({ default: module.OutreachPage })));
const ResumePage = lazy(() => import("@/pages/resume").then((module) => ({ default: module.ResumePage })));
const DatabasePage = lazy(() => import("@/pages/database").then((module) => ({ default: module.DatabasePage })));
const AutomationsPage = lazy(() => import("@/pages/automations").then((module) => ({ default: module.AutomationsPage })));
const SetupPage = lazy(() => import("@/pages/setup").then((module) => ({ default: module.SetupPage })));
const FlowPage = lazy(() => import("@/pages/flow").then((module) => ({ default: module.FlowPage })));

const POLL_MS = 5000;
const KEYS = SECTIONS.map((s) => s.key);

function hashSection(): SectionKey {
  const raw = location.hash.replace(/^#/, "");
  return (KEYS as string[]).includes(raw) ? (raw as SectionKey) : "applications";
}

export default function App() {
  const [section, setSection] = useState<SectionKey>(hashSection);
  const [state, setState] = useState<TrackerState | null>(null);
  const [offline, setOffline] = useState(false);
  const [focusJob, setFocusJob] = useState("");

  const preview = isPreview();

  const refresh = useCallback(async () => {
    // Preview data is generated in memory and never persisted anywhere.
    if (preview) {
      setState(previewState());
      setOffline(false);
      return;
    }
    try {
      setState(await getState());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [preview]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const onHash = () => setSection(hashSection());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((key: SectionKey) => {
    setSection(key);
    if (location.hash !== `#${key}`) history.pushState(null, "", `#${key}`);
  }, []);

  useEffect(() => {
    const meta = SECTIONS.find((s) => s.key === section);
    if (meta) document.title = `${meta.title} · Job Desk`;
  }, [section]);

  const meta = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  const incomplete = state?.setup?.complete === false;
  const badges: Partial<Record<SectionKey, string | number>> = {
    // No Applications badge: a needs-you + ask-me sum reads as an application count.
    outreach: state?.outreach?.stats?.needsReview || undefined,
    setup: incomplete ? "!" : undefined
  };

  const banner =
    incomplete && state?.setup && ["applications", "automations"].includes(section) ? (
      <div className="mx-auto w-full max-w-[1600px] px-4 pt-4 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-[color-mix(in_oklab,var(--warn)_8%,var(--card))] p-3 text-sm">
          <p className="flex min-w-0 items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warn)]" aria-hidden />
            <span>
            <strong>Profile incomplete.</strong>{" "}
            {state.setup.missing?.length
              ? `${state.setup.missing.length} required field${
                  state.setup.missing.length === 1 ? "" : "s"
                } still empty.`
              : "Fill in your profile details."}
            </span>
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate("setup")}>
            Complete profile
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <ThemeProvider>
      <Shell
        preview={preview}
        active={section}
        onNavigate={navigate}
        state={state}
        offline={offline}
        badges={badges}
        banner={banner}
      >
        <PageHead title={meta.title} description={meta.description} />

        <Suspense fallback={<p className="text-muted-foreground text-sm" role="status">Loading workspace…</p>}>
        {!state ? (
          <p className="text-muted-foreground text-sm">
            {offline
              ? "Cannot reach the Job Desk server. Start it with npm start, then reload."
              : "Loading the local dashboard…"}
          </p>
        ) : section === "applications" ? (
          <ApplicationsPage
            state={state}
            refresh={refresh}
            onOutreach={(jobUrl) => {
              setFocusJob(jobUrl);
              navigate("outreach");
            }}
          />
        ) : section === "automations" ? (
          <AutomationsPage refresh={refresh} />
        ) : section === "flow" ? (
          <FlowPage state={state} offline={offline} onNavigate={navigate} />
        ) : section === "outreach" ? (
          <OutreachPage
            state={state}
            refresh={refresh}
            focusJob={focusJob}
            onFocusHandled={() => setFocusJob("")}
            onOpenSetup={() => navigate("setup")}
          />
        ) : section === "resume" ? (
          <ResumePage />
        ) : section === "database" ? (
          <DatabasePage />
        ) : (
          <SetupPage state={state} refresh={refresh} onOpenApplications={() => navigate("applications")} />
        )}
        </Suspense>
      </Shell>
      <Toaster position="bottom-center" />
    </ThemeProvider>
  );
}
