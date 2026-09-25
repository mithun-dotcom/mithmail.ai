"use client";

import { useState, useTransition } from "react";
import { Pause, Play, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, THead } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { FormMessage } from "@/components/form-message";
import { generateIcebreakersAction, removeCampaignLeads, setCampaignLeadStatus } from "../../actions";

export interface Row {
  id: string;
  email: string;
  name: string;
  company: string | null;
  icebreaker: string | null;
  leadStatus: string;
  status: string;
  step: number;
  sender: string | null;
  next: string;
}

export function LeadTable({ campaignId, rows }: { campaignId: string; rows: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ error?: string; message?: string }>({});
  const [pending, start] = useTransition();
  const ids = [...selected];
  const run = (fn: () => Promise<{ error?: string; message?: string } | void>) =>
    start(async () => {
      setMsg((await fn()) ?? {});
      setSelected(new Set());
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Button size="sm" variant="outline" disabled={!ids.length || pending} onClick={() => run(() => setCampaignLeadStatus(campaignId, ids, "PAUSED"))}>
          <Pause /> Pause
        </Button>
        <Button size="sm" variant="outline" disabled={!ids.length || pending} onClick={() => run(() => setCampaignLeadStatus(campaignId, ids, "ACTIVE"))}>
          <Play /> Resume
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!ids.length || pending}
          onClick={() => confirm(`Remove ${ids.length} leads from this campaign?`) && run(() => removeCampaignLeads(campaignId, ids))}
        >
          <Trash2 /> Remove
        </Button>
        <span className="text-xs text-muted-foreground">{ids.length ? `${ids.length} selected` : ""}</span>
        <Button size="sm" variant="gold" className="ml-auto" disabled={pending} onClick={() => run(() => generateIcebreakersAction(campaignId))}>
          <Sparkles /> AI icebreakers
        </Button>
      </div>
      {(msg.error || msg.message) && <div className="p-3"><FormMessage state={msg} /></div>}
      <Table>
        <THead>
          <tr>
            <th className="w-8">
              <input
                type="checkbox"
                checked={rows.length > 0 && selected.size === rows.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
              />
            </th>
            <th>Lead</th><th>Lead status</th><th>Sequence</th><th>Step</th><th>Sender</th><th>Next send</th>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(r.id);
                    else next.delete(r.id);
                    setSelected(next);
                  }}
                />
              </td>
              <td className="max-w-xs">
                <span className="font-medium">{r.email}</span>
                <p className="text-xs text-muted-foreground">{r.name} {r.company && `· ${r.company}`}</p>
                {r.icebreaker && <p className="mt-0.5 truncate text-xs italic text-amber-800" title={r.icebreaker}>“{r.icebreaker}”</p>}
              </td>
              <td><StatusBadge status={r.leadStatus} /></td>
              <td><StatusBadge status={r.status} /></td>
              <td className="tabular-nums">{r.step}</td>
              <td className="text-xs">{r.sender ?? "—"}</td>
              <td className="text-xs text-muted-foreground">{r.next}</td>
            </tr>
          ))}
        </TBody>
      </Table>
    </>
  );
}
