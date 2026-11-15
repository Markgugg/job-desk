import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DataList,
  DataRow,
  EmptyState,
  ExternalLink,
  Notice,
  SectionHead,
  StatCard,
  StatusPill,
  toneForOutreach
} from "@/components/bits";
import { ChartFrame, OutreachLadder, VerticalBars } from "@/components/charts";
import { Building2, Contact, Mails, MessageSquare, Send, Users } from "lucide-react";
import { postJson, type OutreachRow, type TrackerState } from "@/lib/api";
import { MIN_STRATEGY_VOLUME, contactsByType, outreachLadder, replyRateByStrategy } from "@/lib/format";

const human = (value?: string) => String(value ?? "").replaceAll("_", " ").toLowerCase();

const PERSON_FIELDS: { name: string; label: string; required?: boolean; placeholder?: string }[] = [
  { name: "full_name", label: "Name", required: true },
  { name: "current_title", label: "Title", placeholder: "Recruiter, engineer, alum…" },
  { name: "company", label: "Company" },
  { name: "job_url", label: "Tracked job link", placeholder: "Links the person to an application" },
  { name: "linkedin_url", label: "Profile link" },
  { name: "university", label: "School" },
  { name: "notes", label: "Notes", placeholder: "How you know them" }
];

/** What you can record next for a message, given where it is now. */
const NEXT_STEPS: Record<string, { label: string; status: string; primary?: boolean }[]> = {
  NEEDS_REVIEW: [{ label: "Approve", status: "APPROVED", primary: true }, { label: "Mark sent", status: "SENT" }],
  DRAFTED: [{ label: "Approve", status: "APPROVED", primary: true }, { label: "Mark sent", status: "SENT" }],
  APPROVED: [{ label: "Mark sent", status: "SENT", primary: true }],
  SENT: [{ label: "Got a reply", status: "REPLIED", primary: true }, { label: "Positive reply", status: "POSITIVE_REPLY" }],
  FOLLOW_UP_NEEDED: [{ label: "Got a reply", status: "REPLIED", primary: true }],
  REPLIED: [{ label: "Positive reply", status: "POSITIVE_REPLY" }, { label: "Referral offered", status: "REFERRAL_OFFERED" }],
  POSITIVE_REPLY: [{ label: "Referral offered", status: "REFERRAL_OFFERED" }, { label: "Referral received", status: "REFERRAL_RECEIVED", primary: true }],
  REFERRAL_OFFERED: [{ label: "Referral received", status: "REFERRAL_RECEIVED", primary: true }]
};

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("This browser blocked the clipboard");
  }
}

export function OutreachPage({
  state,
  refresh,
  focusJob,
  onFocusHandled
}: {
  state: TrackerState;
  refresh: () => void;
  focusJob: string;
  onFocusHandled: () => void;
  onOpenSetup: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  function prefill(company: string, jobUrl: string) {
    const form = formRef.current;
    if (!form) return;
    (form.elements.namedItem("company") as HTMLInputElement).value = company;
    (form.elements.namedItem("job_url") as HTMLInputElement).value = jobUrl;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    (form.elements.namedItem("full_name") as HTMLInputElement).focus();
  }

  useEffect(() => {
    if (!focusJob) return;
    const app = (state.applications || []).find((row) => row.url === focusJob);
    prefill(app?.company || "", focusJob);
    onFocusHandled();
  }, [focusJob, state.applications, onFocusHandled]);

  const o = state.outreach;
  if (!o) {
    return <EmptyState className="p-11" title="Outreach data is missing" note="The server did not send outreach records. Restart it and reload." />;
  }
  const s = o.stats || {};
  const target = s.experiment?.target || 10;
  const rows = o.rows || [];

  async function act(key: string, work: () => Promise<void>) {
    setBusy(key);
    try {
      await work();
    } catch (err) {
      toast.error("Outreach not updated", { description: String((err as Error).message || err) });
    } finally {
      setBusy("");
      refresh();
    }
  }

  const setStatus = (row: OutreachRow, status: string) =>
    act(row.id, async () => {
      await postJson("/api/outreach/update", { id: row.id, status });
      toast.success(`${row.company}: ${human(status)}`);
    });

  const setConnection = (row: OutreachRow, connection_status: string) =>
    act(row.id, async () => {
      await postJson("/api/outreach/update", { id: row.id, connection_status });
      toast.success(connection_status === "CONNECTED" ? "Marked connected" : "Connection request noted");
    });

  const saveEdit = (row: OutreachRow, message: string) =>
    act(row.id, async () => {
      await postJson("/api/outreach/update", { id: row.id, message });
      setEdits(({ [row.id]: _dropped, ...rest }) => rest);
      toast.success("Message saved");
    });

  async function queueJobs() {
    await act("prepare", async () => {
      const result = await postJson<{ added?: number }>("/api/outreach/prepare", {});
      if (result.added) toast.success(`Queued ${result.added} job${result.added === 1 ? "" : "s"}`, { description: "Each one needs a person attached." });
      else toast("Nothing new to queue", { description: "Your top jobs already have outreach, or the round is full." });
    });
  }

  async function addPerson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    await act("person", async () => {
      await postJson("/api/outreach/contact", payload);
      form.reset();
      toast.success("Person added", { description: "A draft is waiting for your review below." });
    });
  }

  const rates = replyRateByStrategy(s.byStrategy);

  return (
    <div className="space-y-9">
      <SectionHead
        title={s.experiment?.name || "Outreach"}
        note={`${s.sent || 0} of ${target} sent · ${s.responseRate || 0}% replied · ${s.referralRate || 0}% referred`}
        action={
          <Button disabled={busy === "prepare"} onClick={() => void queueJobs()}>
            {busy === "prepare" ? "Queueing…" : "Queue top jobs"}
          </Button>
        }
      />
      {s.smallSample ? <p className="text-muted-foreground text-sm">Fewer than 10 messages sent, so treat these rates as rough.</p> : null}
      {s.complete ? <Notice><p>Round {s.experiment?.id || 1} reached its target of {target} messages.</p></Notice> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Outreach totals">
        <StatCard label="Needs review" value={s.needsReview ?? 0} />
        <StatCard label="Need a person" value={s.needsContact ?? 0} />
        <StatCard label="Approved" value={s.approved ?? 0} />
        <StatCard label="Sent" value={s.sent ?? 0} />
        <StatCard label="Replies" value={s.replies ?? 0} />
        <StatCard label="Positive" value={s.positive ?? 0} />
        <StatCard label="Referrals" value={s.referrals ?? 0} />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <OutreachLadder data={outreachLadder(rows)} footer="Counted from the messages on record." />
        <VerticalBars
          icon={Users}
          title="Contacts by type"
          description="Who the outreach is aimed at"
          data={contactsByType(rows)}
          series={[{ dataKey: "contacts", fill: "var(--chart-2)" }]}
          emptyNote="No people attached yet. Add one below and the mix shows up here."
        />
        {rates.enough ? (
          <VerticalBars
            icon={MessageSquare}
            title="Reply rate by strategy"
            description="Replies as a share of messages sent"
            data={rates.rows}
            series={[{ dataKey: "replyRate", fill: "var(--chart-4)" }]}
            emptyNote="No strategy has enough volume yet."
            footer={`Across ${rates.messages} sent message${rates.messages === 1 ? "" : "s"}.`}
          />
        ) : (
          <ChartFrame
            icon={MessageSquare}
            title="Reply rate by strategy"
            description="Replies as a share of messages sent"
            empty
            emptyNote={`A rate needs at least ${MIN_STRATEGY_VOLUME} sent messages. ${rates.messages ? `So far: ${rates.messages}.` : "None sent yet."}`}
          >
            <span />
          </ChartFrame>
        )}
      </section>

      {(o.dueFollowUps || []).map((due) => {
        const row = rows.find((r) => r.id === due.id);
        return (
          <Notice key={due.id}>
            <p>Time to follow up · {due.company} · {due.role}</p>
            <Button size="sm" variant="outline" onClick={() => void copyText(row?.followUpDraft || "", "Follow-up")}>
              Copy follow-up
            </Button>
          </Notice>
        );
      })}

      {(o.companies || []).length ? (
        <section>
          <SectionHead icon={Building2} title="Companies" note="Up to three people per company." />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(o.companies || []).map((company) => (
              <Card key={company.company} className="gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{company.company}</h3>
                    <p className="text-muted-foreground text-xs">
                      {company.jobs.length} submitted application{company.jobs.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">
                    {company.sent}
                    <span className="text-muted-foreground text-xs font-medium"> sent</span>
                  </p>
                </div>
                <div className="bg-muted h-1 overflow-hidden rounded-full">
                  <div className="bg-foreground h-full rounded-full" style={{ width: `${Math.min(100, ((company.cap - company.remaining) / Math.max(1, company.cap)) * 100)}%` }} />
                </div>
                <ul className="space-y-1.5 text-sm">
                  {company.contacts.slice(0, 6).map((person) => (
                    <li key={person.name} className="flex items-center justify-between gap-2">
                      <span className="font-medium">{person.name}</span>
                      <span className="text-muted-foreground text-xs">{human(person.strategy)} · {human(person.status)}</span>
                    </li>
                  ))}
                  {!company.contacts.length ? <li className="text-muted-foreground text-xs">Nobody attached yet</li> : null}
                </ul>
                <p className="text-muted-foreground border-t pt-3 text-xs">
                  {company.recruiters} recruiting · {company.employees} other · {company.replies} replied · {company.connected} connected ·{" "}
                  {company.remaining ? `${company.remaining} open` : "full"}
                </p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHead icon={Contact} title="Add a person" note="Someone real you found yourself. A first draft is written for you to edit." />
        <form ref={formRef} onSubmit={addPerson} className="bg-card grid gap-3 rounded-xl border p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
          {PERSON_FIELDS.map((field) => (
            <div key={field.name} className="grid gap-1.5">
              <Label htmlFor={`person-${field.name}`}>{field.label}</Label>
              <Input id={`person-${field.name}`} name={field.name} placeholder={field.placeholder} required={field.required} />
            </div>
          ))}
          <div className="flex items-end">
            <Button type="submit" disabled={busy === "person"}>{busy === "person" ? "Adding…" : "Add and draft"}</Button>
          </div>
        </form>
      </section>

      <section>
        <SectionHead icon={Mails} title="Messages" note="Find a person, review the draft, send it yourself, then record what happened." />
        {rows.length === 0 ? (
          <EmptyState title="No outreach yet" note="Queue your top jobs, or add a person above." />
        ) : (
          <div className="grid gap-3">
            {rows.map((row) => (
              <MessageCard
                key={row.id}
                row={row}
                busy={busy === row.id}
                draft={edits[row.id]}
                onDraft={(value) => setEdits((prev) => ({ ...prev, [row.id]: value }))}
                onSave={(message) => void saveEdit(row, message)}
                onStatus={(status) => void setStatus(row, status)}
                onConnection={(value) => void setConnection(row, value)}
                onAttach={() => prefill(row.company, row.job_id)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHead icon={Send} title="Job priority" note="Submitted applications by tier. Spend outreach on tier A first." />
        {(o.ranked || []).length === 0 ? (
          <EmptyState title="No submitted jobs yet" note="Jobs show up here once they are marked submitted." />
        ) : (
          <DataList>
            {(o.ranked || []).slice(0, 12).map((job) => (
              <DataRow key={job.url}>
                <div className="font-medium"><ExternalLink href={job.url}>{job.company}</ExternalLink></div>
                <div className="text-muted-foreground truncate text-sm">{job.role}</div>
                <div>
                  <StatusPill tone={job.tier === "A" ? "submitted" : job.tier === "B" ? "waiting" : "neutral"}>Tier {job.tier}</StatusPill>
                </div>
                <div className="text-muted-foreground text-xs">{job.submitted_at || ""}</div>
                <div className="sm:justify-self-end">
                  <Button size="sm" variant="outline" onClick={() => prefill(job.company, job.url)}>Add a person</Button>
                </div>
                <div />
              </DataRow>
            ))}
          </DataList>
        )}
      </section>
    </div>
  );
}

function MessageCard({
  row,
  busy,
  draft,
  onDraft,
  onSave,
  onStatus,
  onConnection,
  onAttach
}: {
  row: OutreachRow;
  busy: boolean;
  draft?: string;
  onDraft: (value: string) => void;
  onSave: (message: string) => void;
  onStatus: (status: string) => void;
  onConnection: (value: string) => void;
  onAttach: () => void;
}) {
  const person = row.contact || {};
  const status = String(row.status || "");
  const saved = row.final_message ?? row.generated_message ?? "";
  const message = draft ?? saved;
  const steps = NEXT_STEPS[status] || [];
  const issues = row.quality?.verdict === "PASS" ? [] : row.quality?.reasons || [];
  const hasPerson = Boolean(person.full_name);
  const timeline = (row.history || []).map((h) => `${human(h.status)} ${String(h.at || "").slice(0, 10)}`).join(" → ");

  return (
    <Card className="gap-2.5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold"><ExternalLink href={row.job_id}>{row.company}</ExternalLink></p>
          <p className="text-muted-foreground text-sm">{row.role}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill tone={toneForOutreach(status)}>{human(status)}</StatusPill>
          {row.relevance_score != null ? (
            <p className="text-sm tabular-nums"><b className="text-base">{row.relevance_score}</b> <span className="text-muted-foreground text-xs">fit</span></p>
          ) : null}
        </div>
      </div>

      {status === "NEEDS_CONTACT" || !hasPerson ? (
        <>
          <p className="text-muted-foreground text-sm">{status === "SKIPPED" ? `Skipped${row.notes ? `: ${row.notes}` : "."}` : "No person attached yet."}</p>
          {(row.search_plan || []).length ? (
            <p className="text-muted-foreground text-xs">
              Search for:{" "}
              {(row.search_plan || []).map((plan, i) => (
                <span key={plan.url}>{i ? " · " : ""}<ExternalLink href={plan.url}>{human(plan.kind)}</ExternalLink></span>
              ))}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {status === "SKIPPED" ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus("NEEDS_CONTACT")}>Reopen</Button>
            ) : (
              <>
                <Button size="sm" onClick={onAttach}>Add person</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus("SKIPPED")}>Skip</Button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            <strong className="text-foreground">{person.full_name || "Unknown person"}</strong>
            {person.current_title ? ` · ${person.current_title}` : ""} · {human(row.strategy)}
          </p>
          {(row.relevance_reasons || []).length ? <p className="text-muted-foreground text-xs">Why: {(row.relevance_reasons || []).join(" · ")}</p> : null}
          {issues.length ? <p className="text-xs text-[var(--warn)]">Check the draft: {issues.join("; ")}</p> : null}
          {timeline ? <p className="text-muted-foreground text-xs">History: {timeline}</p> : null}

          {message ? (
            <div className="grid gap-2">
              <Label className="sr-only" htmlFor={`message-${row.id}`}>Message to {person.full_name || row.company}</Label>
              <Textarea id={`message-${row.id}`} className="bg-muted min-h-24" value={message} onChange={(e) => onDraft(e.target.value)} />
              <p className="text-muted-foreground text-xs tabular-nums">{message.length} characters</p>
            </div>
          ) : null}
          {row.resumeReply ? <p className="text-muted-foreground text-xs">Suggested reply: {row.resumeReply}</p> : null}

          <div className="mt-1 flex flex-wrap gap-1.5">
            {draft !== undefined && draft !== saved ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onSave(draft)}>Save edit</Button>
            ) : null}
            {message ? <Button size="sm" variant="outline" onClick={() => void copyText(message, "Message")}>Copy</Button> : null}
            {steps.map((step) => (
              <Button key={step.status} size="sm" variant={step.primary ? "default" : "outline"} disabled={busy} onClick={() => onStatus(step.status)}>
                {step.label}
              </Button>
            ))}
            {row.resumeReply ? <Button size="sm" variant="outline" onClick={() => void copyText(row.resumeReply || "", "Reply")}>Copy reply</Button> : null}
            {row.resume?.href ? <a href={row.resume.href} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>Resume</a> : null}
            {person.linkedin_url ? <a href={person.linkedin_url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>Profile</a> : null}
            {person.connection_status === "CONNECTED" ? (
              <StatusPill tone="submitted">Connected</StatusPill>
            ) : person.connection_status === "REQUESTED" ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onConnection("CONNECTED")}>Request accepted</Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onConnection("REQUESTED")}>I sent a request</Button>
            )}
            {status === "SKIPPED" ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus("NEEDS_REVIEW")}>Reopen</Button>
            ) : status !== "REFERRAL_RECEIVED" ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus("SKIPPED")}>Skip</Button>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
}
