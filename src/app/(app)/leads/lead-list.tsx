"use client";

import { useState, useTransition } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Table, TBody, THead } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { addLeadsToCampaign, deleteLeads } from "./actions";

export interface LeadRow {
  id: string;
  email: string;
  name: string;
  company: string | null;
  esp: string;
  campaigns: string;
  status: string;
}

export function LeadList({ rows, campaigns, canEdit }: { rows: LeadRow[]; campaigns: { id: string; name: string }[]; canEdit: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const ids = [...selected];

  return (
    <>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="h-8 w-56 text-xs">
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={!ids.length || !campaignId || pending}
            onClick={() =>
              start(async () => {
                const n = await addLeadsToCampaign(ids, campaignId);
                setMsg(`Added ${n} leads to the campaign.`);
                setSelected(new Set());
              })
            }
          >
            <UserPlus /> Add to campaign
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!ids.length || pending}
            onClick={() =>
              confirm(`Delete ${ids.length} leads and their history?`) &&
              start(async () => {
                await deleteLeads(ids);
                setMsg(`Deleted ${ids.length} leads.`);
                setSelected(new Set());
              })
            }
          >
            <Trash2 /> Delete
          </Button>
          <span className="text-xs text-muted-foreground">{ids.length ? `${ids.length} selected` : msg}</span>
        </div>
      )}
      <Table>
        <THead>
          <tr>
            {canEdit && (
              <th className="w-8">
                <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
              </th>
            )}
            <th>Email</th><th>Name</th><th>Company</th><th>Provider</th><th>Campaigns</th><th>Status</th>
          </tr>
        </THead>
        <TBody>
          {rows.map((l) => (
            <tr key={l.id}>
              {canEdit && (
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(l.id);
                      else next.delete(l.id);
                      setSelected(next);
                    }}
                  />
                </td>
              )}
              <td className="font-medium">{l.email}</td>
              <td>{l.name || "—"}</td>
              <td>{l.company ?? "—"}</td>
              <td className="text-xs text-muted-foreground">{l.esp.toLowerCase()}</td>
              <td className="text-xs">{l.campaigns || "—"}</td>
              <td><StatusBadge status={l.status} /></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">No leads yet — import a CSV above.</td></tr>
          )}
        </TBody>
      </Table>
    </>
  );
}
