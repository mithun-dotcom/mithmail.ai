"use client";

import { useState, useTransition } from "react";
import { Copy, Pause, Play, Trash2 } from "lucide-react";
import type { CampaignStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { deleteCampaign, duplicateCampaign, launchCampaign, pauseCampaign } from "../actions";

export function CampaignControls({ id, status }: { id: string; status: CampaignStatus }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; message?: string }>({});

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        {status === "ACTIVE" ? (
          <Button variant="secondary" disabled={pending} onClick={() => start(async () => setMsg(await pauseCampaign(id)))}>
            <Pause /> Pause
          </Button>
        ) : (
          <Button variant="gold" disabled={pending} onClick={() => start(async () => setMsg(await launchCampaign(id)))}>
            <Play /> {status === "PAUSED" ? "Resume" : "Launch"}
          </Button>
        )}
        <Button variant="outline" size="icon" title="Duplicate" disabled={pending} onClick={() => start(() => duplicateCampaign(id))}>
          <Copy />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Delete"
          disabled={pending}
          onClick={() => confirm("Delete this campaign and its history?") && start(() => deleteCampaign(id))}
        >
          <Trash2 />
        </Button>
      </div>
      {msg.error && <p className="max-w-md text-right text-sm text-red-700">{msg.error}</p>}
    </div>
  );
}
