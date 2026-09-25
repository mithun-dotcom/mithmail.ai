/**
 * In-process mail harness for integration tests: one IMAP server (hoodiecrow) per
 * mailbox plus an SMTP server that delivers into them. Addresses listed in
 * `spamFor` receive mail in their Junk folder instead of INBOX.
 */
import { SMTPServer } from "smtp-server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hoodiecrow = require("hoodiecrow-imap");

type Hoodie = {
  listen: (port: number, cb: () => void) => void;
  close: (cb?: () => void) => void;
  getMailbox: (path: string) => { messages: { raw: string; flags: string[] }[] };
  appendMessage: (mailbox: unknown, flags: string[], date: Date, raw: string) => void;
};

export interface Harness {
  smtpPort: number;
  imapPort: (address: string) => number;
  mailbox: (address: string, folder?: string) => { raw: string; flags: string[] }[];
  deliver: (address: string, raw: string, folder?: string) => void;
  outside: { to: string; raw: string }[]; // mail to addresses without a mailbox (e.g. leads)
  close: () => Promise<void>;
}

export async function startHarness(opts: { mailboxes: string[]; spamFor?: string[]; basePort: number }): Promise<Harness> {
  const servers = new Map<string, { srv: Hoodie; port: number }>();
  let port = opts.basePort;
  for (const address of opts.mailboxes) {
    const srv: Hoodie = hoodiecrow({
      plugins: ["ID", "SPECIAL-USE", "UIDPLUS", "MOVE"],
      users: { [address]: { password: "p" } },
      storage: { INBOX: { messages: [] }, "": { separator: "/", folders: { Junk: { "special-use": "\\Junk", messages: [] } } } },
    });
    const p = port++;
    await new Promise<void>((r) => srv.listen(p, r));
    servers.set(address, { srv, port: p });
  }
  const outside: { to: string; raw: string }[] = [];
  const deliver = (address: string, raw: string, folder = "INBOX") => {
    const s = servers.get(address);
    if (s) s.srv.appendMessage(s.srv.getMailbox(folder), [], new Date(), raw);
    else outside.push({ to: address, raw });
  };
  const smtpPort = port++;
  const smtp = new SMTPServer({
    authOptional: true,
    allowInsecureAuth: true,
    disabledCommands: ["STARTTLS"],
    onAuth: (_a, _s, cb) => cb(null, { user: "x" }),
    onRcptTo(address, _s, cb) {
      if (address.address.startsWith("bounce")) return cb(Object.assign(new Error("550 5.1.1 User unknown"), { responseCode: 550 }));
      cb();
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const raw = Buffer.concat(chunks).toString("binary");
        for (const r of session.envelope.rcptTo) deliver(r.address, raw, opts.spamFor?.includes(r.address) ? "Junk" : "INBOX");
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(smtpPort, r));

  return {
    smtpPort,
    imapPort: (a) => servers.get(a)!.port,
    mailbox: (a, folder = "INBOX") => servers.get(a)!.srv.getMailbox(folder).messages,
    deliver,
    outside,
    close: async () => {
      await new Promise<void>((r) => smtp.close(() => r()));
      for (const { srv } of servers.values()) srv.close();
    },
  };
}

export function header(raw: string, name: string): string | undefined {
  const m = new RegExp(`^${name}:\\s*(.+)$`, "im").exec(raw);
  return m?.[1]?.trim();
}
