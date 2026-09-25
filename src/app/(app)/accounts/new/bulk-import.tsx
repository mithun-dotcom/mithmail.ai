"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/form-message";
import { bulkImportAccounts, type ActionState } from "../actions";

const TEMPLATE =
  "email,from_name,smtp_host,smtp_port,smtp_user,smtp_pass,imap_host,imap_port,imap_user,imap_pass,daily_limit\n" +
  "jane@acme-mail.com,Jane Doe,smtp.acme-mail.com,587,jane@acme-mail.com,secret,imap.acme-mail.com,993,,,30\n";

export function BulkImport() {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Upload a CSV with one inbox per row.{" "}
        <a className="text-primary underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="mithmill-inboxes.csv">
          Download template
        </a>
      </p>
      <Input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim().toLowerCase(),
            complete: (r) => setRows(r.data),
          });
        }}
      />
      {rows.length > 0 && (
        <Button
          disabled={pending}
          onClick={() => start(async () => setState(await bulkImportAccounts(rows)))}
          className="justify-self-start"
        >
          {pending ? "Importing…" : `Import ${rows.length} inboxes`}
        </Button>
      )}
      <FormMessage state={state} />
    </div>
  );
}
