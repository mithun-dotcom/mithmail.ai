"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormMessage } from "@/components/form-message";
import { addSmtpAccount, type ActionState } from "../actions";

const PRESETS = {
  SMTP: { smtpHost: "", smtpPort: "587", imapHost: "", imapPort: "993" },
  GOOGLE: { smtpHost: "smtp.gmail.com", smtpPort: "465", imapHost: "imap.gmail.com", imapPort: "993" },
  MICROSOFT: { smtpHost: "smtp.office365.com", smtpPort: "587", imapHost: "outlook.office365.com", imapPort: "993" },
};

export function SmtpForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addSmtpAccount, {});
  const [provider, setProvider] = useState<keyof typeof PRESETS>("SMTP");
  const [hosts, setHosts] = useState(PRESETS.SMTP);
  const [email, setEmail] = useState("");

  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label>Provider</Label>
          <Select
            name="provider"
            value={provider}
            onChange={(e) => {
              const p = e.target.value as keyof typeof PRESETS;
              setProvider(p);
              setHosts(PRESETS[p]);
            }}
          >
            <option value="SMTP">Other (SMTP / IMAP)</option>
            <option value="GOOGLE">Google (app password)</option>
            <option value="MICROSOFT">Microsoft (app password)</option>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Email address</Label>
          <Input name="emailAddress" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme-mail.com" />
        </div>
        <div className="grid gap-1.5">
          <Label>From name</Label>
          <Input name="fromName" placeholder="Jane Doe" />
        </div>
      </div>

      <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-4">
        <legend className="px-1 text-sm font-medium text-royal-800">SMTP (sending)</legend>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Host</Label>
          <Input name="smtpHost" required value={hosts.smtpHost} onChange={(e) => setHosts({ ...hosts, smtpHost: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label>Port</Label>
          <Input name="smtpPort" type="number" required value={hosts.smtpPort} onChange={(e) => setHosts({ ...hosts, smtpPort: e.target.value })} />
        </div>
        <div />
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Username</Label>
          <Input name="smtpUser" required defaultValue={email} key={`u-${email}`} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Password</Label>
          <Input name="smtpPass" type="password" required autoComplete="new-password" />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-4">
        <legend className="px-1 text-sm font-medium text-royal-800">IMAP (reply detection)</legend>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Host</Label>
          <Input name="imapHost" required value={hosts.imapHost} onChange={(e) => setHosts({ ...hosts, imapHost: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label>Port</Label>
          <Input name="imapPort" type="number" required value={hosts.imapPort} onChange={(e) => setHosts({ ...hosts, imapPort: e.target.value })} />
        </div>
        <div />
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Username (blank = SMTP username)</Label>
          <Input name="imapUser" />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Password (blank = SMTP password)</Label>
          <Input name="imapPass" type="password" autoComplete="new-password" />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <Label>Daily sending limit</Label>
          <Input name="dailyLimit" type="number" min={1} max={500} defaultValue={30} className="w-32" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
          <input type="checkbox" name="skipTest" /> Skip connection test
        </label>
        <Button type="submit" disabled={pending} className="ml-auto">
          {pending ? "Testing connection…" : "Connect inbox"}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
