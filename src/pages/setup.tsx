import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/bits";
import type { TrackerState } from "@/lib/api";
import { ProfileEditor } from "@/components/profile-editor";

export function SetupPage({ state, refresh }: { state: TrackerState; onOpenApplications: () => void; refresh: () => Promise<void> }) {
  const setup = state.setup;
  if (!setup) {
    return (
      <EmptyState
        title="Setup status unavailable"
        note="The server did not report profile completeness."
      />
    );
  }

  const missing = Array.isArray(setup.missing) ? setup.missing : [];
  const complete = Boolean(setup.complete);

  return (
    <div className="space-y-6">
      <Card className="gap-3 p-5">
        <div className="flex items-start gap-3">
          <span
            className="mt-1.5 size-2.5 shrink-0 rounded-full"
            style={{ background: complete ? "var(--ok)" : "var(--warn)" }}
            aria-hidden
          />
          <div>
            <h3 className="text-base font-semibold">
              {complete
                ? "Profile complete"
                : `${missing.length} field${missing.length === 1 ? "" : "s"} still needed`}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {complete
                ? "Your basic details are saved. Your resume is the next step."
                : "Everything else works now. Fill in the remaining fields when you have them."}
            </p>
          </div>
        </div>
        <div className="bg-muted h-1 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full"
            style={{ width: complete ? "100%" : "0%", background: "var(--ok)" }}
          />
        </div>
      </Card>

      <ProfileEditor missing={missing} onSaved={refresh} />

      <div className="flex items-center justify-between rounded-xl border p-5">
        <div><p className="font-medium">Next: your resume</p><p className="text-muted-foreground text-sm">Upload your base PDF and review keyword coverage per job.</p></div>
        <a href="#resume" className="text-sm font-medium underline">Go to Resume →</a>
      </div>
    </div>
  );
}
