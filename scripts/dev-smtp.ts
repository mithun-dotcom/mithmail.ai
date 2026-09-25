/**
 * Local capture SMTP server for development.
 *   npx tsx scripts/dev-smtp.ts            # listens on :2525, prints each message
 * Connect an inbox with SMTP host "localhost", port 2525, any username/password.
 */
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { mkdirSync, writeFileSync } from "node:fs";

const port = Number(process.env.DEV_SMTP_PORT ?? 2525);
const outDir = process.env.DEV_SMTP_DIR ?? ".dev-mail";
mkdirSync(outDir, { recursive: true });

const server = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ["STARTTLS"],
  onAuth(_auth, _session, cb) {
    cb(null, { user: "dev" });
  },
  onRcptTo(address, _session, cb) {
    // Simulate a hard bounce for any recipient starting with "bounce".
    if (address.address.startsWith("bounce")) return cb(Object.assign(new Error("550 5.1.1 User unknown"), { responseCode: 550 }));
    cb();
  },
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", async () => {
      const raw = Buffer.concat(chunks);
      const mail = await simpleParser(raw);
      const file = `${outDir}/${Date.now()}-${session.id}.eml`;
      writeFileSync(file, raw);
      console.log(
        JSON.stringify({ to: session.envelope.rcptTo.map((r) => r.address), subject: mail.subject, messageId: mail.messageId, inReplyTo: mail.inReplyTo, file }),
      );
      cb();
    });
  },
});

server.listen(port, () => console.log(`dev SMTP listening on :${port}, saving to ${outDir}/`));
