"use client";

import { useState, useTransition } from "react";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendReply, suggestReplyAction } from "./actions";

export function ReplyBox({ threadId }: { threadId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="border-t bg-white p-4">
      <Textarea
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a reply… (sent from the inbox the lead replied to, in the same thread)"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await suggestReplyAction(threadId);
                if (res.error) setError(res.error);
                else if (res.reply) {
                  setBody(res.reply);
                  setError("");
                }
              })
            }
          >
            <Sparkles className="text-gold-500" /> Suggest reply
          </Button>
          <p className="text-xs text-red-700">{error}</p>
        </div>
        <Button
          disabled={pending || !body.trim()}
          onClick={() =>
            start(async () => {
              const res = await sendReply(threadId, body);
              if (res.error) setError(res.error);
              else {
                setBody("");
                setError("");
              }
            })
          }
        >
          <Send /> {pending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </div>
  );
}
