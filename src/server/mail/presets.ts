import type { EmailProvider } from "@prisma/client";

export interface ServerPreset {
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
}

// Used for app-password connections and as defaults in the "add account" form.
export const PROVIDER_PRESETS: Record<Exclude<EmailProvider, "SMTP">, ServerPreset> = {
  GOOGLE: { smtpHost: "smtp.gmail.com", smtpPort: 465, imapHost: "imap.gmail.com", imapPort: 993 },
  MICROSOFT: { smtpHost: "smtp.office365.com", smtpPort: 587, imapHost: "outlook.office365.com", imapPort: 993 },
};
