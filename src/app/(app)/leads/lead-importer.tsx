"use client";

import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importLeadsAction } from "./actions";

const FIELDS = [
  { key: "email", label: "Email", guess: /^(e-?mail|email address|work email)$/i },
  { key: "firstName", label: "First name", guess: /^(first[ _]?name|firstname|given name)$/i },
  { key: "lastName", label: "Last name", guess: /^(last[ _]?name|lastname|surname|family name)$/i },
  { key: "companyName", label: "Company", guess: /^(company|company[ _]?name|organization|organisation|account)$/i },
  { key: "linkedinUrl", label: "LinkedIn URL", guess: /linkedin/i },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];
const CUSTOM = "__custom";
const SKIP = "__skip";
const CHUNK = 1000;

export function LeadImporter({ campaigns, defaultCampaignId }: { campaigns: { id: string; name: string }[]; defaultCampaignId?: string }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [campaignId, setCampaignId] = useState(defaultCampaignId ?? "");
  const [progress, setProgress] = useState<string>("");
  const [pending, start] = useTransition();

  const hasEmail = useMemo(() => Object.values(mapping).includes("email"), [mapping]);

  function onFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => {
        const hs = r.meta.fields ?? [];
        setHeaders(hs);
        setRows(r.data);
        const m: Record<string, string> = {};
        for (const h of hs) m[h] = FIELDS.find((f) => f.guess.test(h.trim()))?.key ?? CUSTOM;
        setMapping(m);
        setProgress("");
      },
    });
  }

  function runImport() {
    start(async () => {
      const mapped = rows.map((row) => {
        const lead: Record<string, unknown> & { customVariables: Record<string, string> } = { email: "", customVariables: {} };
        for (const h of headers) {
          const target = mapping[h];
          const v = (row[h] ?? "").trim();
          if (!v || target === SKIP) continue;
          if (target === CUSTOM) lead.customVariables[h.trim()] = v;
          else lead[target as FieldKey] = v;
        }
        return lead as { email: string; customVariables: Record<string, string> };
      });
      const totals = { created: 0, updated: 0, invalid: 0, blocked: 0, addedToCampaign: 0 };
      for (let i = 0; i < mapped.length; i += CHUNK) {
        setProgress(`Importing ${Math.min(i + CHUNK, mapped.length)} / ${mapped.length}…`);
        const res = await importLeadsAction(mapped.slice(i, i + CHUNK), campaignId || undefined);
        if (res.error) {
          setProgress(res.error);
          return;
        }
        for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += res[k];
      }
      setProgress(
        `Done: ${totals.created} new, ${totals.updated} updated, ${totals.invalid} invalid, ${totals.blocked} blocklisted` +
          (campaignId ? `, ${totals.addedToCampaign} added to campaign.` : "."),
      );
      setRows([]);
      setHeaders([]);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import leads from CSV</CardTitle>
        <CardDescription>Map your columns. Unmapped columns become custom variables you can use as {"{{column name}}"}.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground hover:bg-muted/50">
          <Upload className="h-4 w-4" />
          {rows.length ? `${rows.length} rows loaded — choose another file` : "Choose a CSV file"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>

        {headers.length > 0 && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {headers.map((h) => (
                <div key={h} className="grid gap-1">
                  <Label className="truncate text-xs text-muted-foreground">
                    {h} <span className="font-normal">· e.g. {rows[0]?.[h]?.slice(0, 24) || "—"}</span>
                  </Label>
                  <Select value={mapping[h]} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                    {FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                    <option value={CUSTOM}>Custom variable</option>
                    <option value={SKIP}>Don&apos;t import</option>
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <Label>Also add to campaign</Label>
                <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="w-64">
                  <option value="">— none —</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <Button disabled={!hasEmail || pending} onClick={runImport}>
                {pending ? "Importing…" : `Import ${rows.length} leads`}
              </Button>
              {!hasEmail && <p className="text-sm text-red-700">Map one column to Email.</p>}
            </div>
          </>
        )}
        {progress && <p className="text-sm text-royal-800">{progress}</p>}
      </CardContent>
    </Card>
  );
}
