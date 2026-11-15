import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { getOptional, postOptional } from "@/lib/api";
import { isPreview } from "@/lib/preview";

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
type Profile = { [key: string]: Value };
interface Field {
  key: string;
  label: string;
  type: "group" | "records" | "list" | "number" | "boolean" | "textarea" | "text";
  nullable: boolean;
  fields?: Field[];
}
interface EditableProfile { profile: Profile; revision: string; fields: Field[] }

function blank(field: Field): Value {
  if (field.nullable) return null;
  if (field.type === "group") return Object.fromEntries((field.fields || []).map((f) => [f.key, blank(f)]));
  if (field.type === "records" || field.type === "list") return [];
  if (field.type === "boolean") return false;
  if (field.type === "number") return 0;
  return "";
}

function ProfileField({ field, value, path, onChange, missing }: {
  field: Field; value: Value | undefined; path: string; onChange: (value: Value) => void; missing: string[];
}) {
  const id = `profile-${path}`;
  if (field.type === "group") {
    const object = (value || {}) as Profile;
    return <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
      <legend className="px-1 font-semibold">{field.label}</legend>
      {field.fields?.map((child) => <ProfileField key={child.key} field={child} value={object[child.key]}
        path={`${path}.${child.key}`} missing={missing} onChange={(next) => onChange({ ...object, [child.key]: next })} />)}
    </fieldset>;
  }
  if (field.type === "records") {
    const rows = (Array.isArray(value) ? value : []) as Profile[];
    return <fieldset className="space-y-3 sm:col-span-2">
      <legend className="text-sm font-medium">{field.label}</legend>
      {rows.map((row, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
        {field.fields?.map((child) => <ProfileField key={child.key} field={child} value={row[child.key]}
          path={`${path}.${index}.${child.key}`} missing={missing}
          onChange={(next) => onChange(rows.map((old, i) => i === index ? { ...old, [child.key]: next } : old))} />)}
        <Button type="button" variant="ghost" className="justify-self-start" onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove entry {index + 1}</Button>
      </div>)}
      <Button type="button" variant="outline" onClick={() => onChange([...rows, Object.fromEntries((field.fields || []).map((f) => [f.key, blank(f)]))])}>Add {field.label.toLowerCase()} entry</Button>
    </fieldset>;
  }
  const isMissing = missing.includes(path);
  return <div className={`grid content-start gap-1.5 ${field.type === "textarea" || field.type === "list" ? "sm:col-span-2" : ""}`}>
    <Label htmlFor={id}>{field.label}{isMissing ? <span className="text-[var(--warn)]"> · needed</span> : null}</Label>
    {field.type === "boolean" ? (
      <select id={id} className="bg-background h-9 w-full rounded-md border px-3 text-sm" value={value === null || value === undefined ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "true")}>
        {(field.nullable || value === undefined) ? <option value="">Not answered</option> : null}
        <option value="true">Yes</option><option value="false">No</option>
      </select>
    ) : field.type === "list" ? (
      <Textarea id={id} rows={3} value={Array.isArray(value) ? value.join("\n") : ""}
        placeholder="One item per line" onChange={(event) => onChange(event.target.value.split("\n"))} />
    ) : field.type === "textarea" ? (
      <Textarea id={id} rows={4} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />
    ) : (
      <Input id={id} type={field.type === "number" ? "number" : field.key === "email" ? "email" : field.key === "phone" ? "tel" : "text"}
        min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? "any" : undefined}
        value={String(value ?? "")} onChange={(event) => onChange(field.type === "number"
          ? event.target.value === "" ? (field.nullable ? null : "") : Number(event.target.value)
          : event.target.value)} />
    )}
  </div>;
}

export function ProfileEditor({ missing, onSaved }: { missing: string[]; onSaved: () => Promise<void> }) {
  const [data, setData] = useState<EditableProfile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const preview = isPreview();
  async function load() {
    setLoading(true); setError(""); setMessage("");
    try { setData(await getOptional<EditableProfile>("/api/profile")); setDirty(false); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (!preview) void load(); else setLoading(false); }, [preview]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!data || preview) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await postOptional<EditableProfile>("/api/profile", { profile: data.profile, revision: data.revision });
      setData(result); setDirty(false); setMessage("Profile saved on this computer.");
      await onSaved();
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }
  if (preview) return <Card className="p-5">Profile editing is available in the live dashboard. Preview mode does not read or change your personal details.</Card>;
  return <form onSubmit={save} className="space-y-4">
    <Card className="gap-3 p-5">
      <h3 className="font-semibold">Your details</h3>
      <p className="text-muted-foreground text-sm">Start with contact details and education. Everything else is optional until an application needs it. Save before switching pages.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={loading || saving || !dirty}>{saving ? "Saving…" : "Save profile"}</Button>
        <Button type="button" variant="outline" disabled={saving || loading} onClick={() => {
          if (!dirty || window.confirm("Discard unsaved edits and reload the saved profile?")) void load();
        }}>Reload saved profile</Button>
        {dirty ? <span className="text-sm text-[var(--warn)]">Unsaved changes</span> : null}
      </div>
      {loading ? <p role="status">Loading profile…</p> : null}
      {message ? <p role="status" className="text-sm text-[var(--ok)]">{message}</p> : null}
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
    </Card>
    <fieldset disabled={saving || loading} className="space-y-4">
      {data?.fields.map((field) => {
        const basic = ["personal", "links", "education"].includes(field.key);
        const visibleField = field.key === "personal" ? { ...field, fields: field.fields?.filter((f) => !["nationality", "open_to_relocation", "phone_country_code"].includes(f.key)) }
          : field.key === "education" ? { ...field, fields: field.fields?.filter((f) => ["school", "degree", "major", "graduation", "start_year"].includes(f.key)) } : field;
        const editor = <ProfileField field={visibleField} value={data.profile[field.key]}
          path={field.key} missing={missing} onChange={(value) => {
            setData({ ...data, profile: { ...data.profile, [field.key]: value } }); setDirty(true); setMessage("");
          }} />;
        return basic ? <div key={field.key}>{editor}
          {visibleField.fields?.length !== field.fields?.length ? <details className="mt-3 rounded-lg border p-4">
            <summary className="cursor-pointer text-sm">More {field.label.toLowerCase()} details</summary>
            <div className="mt-4"><ProfileField field={{ ...field, fields: field.fields?.filter((f) => !visibleField.fields?.some((v) => v.key === f.key)) }} value={data.profile[field.key]} path={field.key} missing={missing} onChange={(value) => { setData({ ...data, profile: { ...data.profile, [field.key]: value } }); setDirty(true); setMessage(""); }} /></div>
          </details> : null}
        </div> : <details key={field.key} className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">{field.label}<span className="text-muted-foreground ml-2 font-normal">Optional details</span></summary>
          <div className="mt-4">{editor}</div>
        </details>;
      })}
    </fieldset>
    {data ? <Button type="submit" disabled={saving || loading || !dirty}>{saving ? "Saving…" : "Save profile"}</Button> : null}
  </form>;
}
