"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendReply } from "./actions";

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
        <p className="text-xs text-red-700">{error}</p>
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
