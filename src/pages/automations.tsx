import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postOptional } from "@/lib/api";
import { isPreview } from "@/lib/preview";
import { JobMatches } from "@/components/job-matches";

type ScanResult = { totals?: { evidence?: number }; scanned?: { error?: string | null }[]; error?: string };

export function AutomationsPage({ refresh }: { refresh: () => Promise<void> }) {
  const preview = isPreview();
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("planned");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function addJob(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await postOptional("/api/applications", { url: url.trim(), company: company.trim(), role: role.trim(), status });
      toast.success(`${company.trim()} added`, { description: status === "submitted" ? "Recorded as submitted today." : "Listed as ready to submit." });
      setUrl(""); setCompany(""); setRole("");
      await refresh();
    } catch (err) {
      toast.error("Job not added", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function rescan() {
    setScanning(true);
    try {
      const result = await postOptional<ScanResult>("/api/corpus/scan", {});
      const failed = (result.scanned || []).filter((row) => row.error).length;
      if (result.error || failed) toast.error("Some sources did not scan", { description: result.error || `${failed} source(s) reported an error. See Evidence.` });
      else toast.success(`Evidence refreshed · ${result.totals?.evidence ?? 0} facts`);
    } catch (err) {
      toast.error("Rescan failed", { description: (err as Error).message });
    } finally {
      setScanning(false);
    }
  }

  return <div className="space-y-6">
    {preview ? <p className="text-muted-foreground text-sm">Actions are disabled in the sample preview.</p> : null}
    <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card className="gap-4 p-5">
        <div><h3 className="font-semibold">Add a job</h3><p className="text-muted-foreground mt-1 text-sm">Track a posting you found anywhere. It shows up in Applications, Progress and Outreach.</p></div>
        <form onSubmit={addJob} className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2"><Label htmlFor="job-url">Job link</Label><Input id="job-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
          <div className="grid gap-2"><Label htmlFor="job-company">Company</Label><Input id="job-company" required value={company} onChange={(e) => setCompany(e.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="job-role">Role</Label><Input id="job-role" required value={role} onChange={(e) => setRole(e.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="job-status">Where it stands</Label>
            <select id="job-status" className="bg-background h-9 rounded-md border px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="planned">Planning to apply</option>
              <option value="submitted">Already submitted</option>
            </select>
          </div>
          <div className="flex items-end"><Button type="submit" disabled={preview || saving || !company.trim() || !role.trim()}>{saving ? "Adding…" : "Add job"}</Button></div>
        </form>
      </Card>
      <Card className="gap-4 p-5">
        <div><h3 className="font-semibold">Refresh evidence</h3><p className="text-muted-foreground mt-1 text-sm">Rescan the repositories and notes you connected. Review new facts on Evidence.</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={preview || scanning} onClick={() => void rescan()}>{scanning ? "Scanning…" : "Refresh evidence"}</Button>
          <a href="#database" className="text-sm underline">Open Evidence →</a>
        </div>
      </Card>
    </div>
    <JobMatches preview={preview} onTracked={refresh} />
  </div>;
}
