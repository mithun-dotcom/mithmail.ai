import Link from "next/link";
import { ArrowRight, Flame, Inbox, Layers, ShieldCheck, Sparkles, Shuffle } from "lucide-react";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const features = [
  { icon: Layers, title: "Unlimited inboxes", body: "Connect Google, Microsoft or any SMTP/IMAP inbox. Spread volume across hundreds of senders." },
  { icon: Shuffle, title: "Inbox rotation", body: "Every campaign round-robins across its inboxes with randomized gaps and per-inbox daily caps." },
  { icon: Flame, title: "Built-in warm-up", body: "A peer network that sends, opens, rescues from spam and replies — building reputation on autopilot." },
  { icon: ShieldCheck, title: "DNS health", body: "Daily SPF, DKIM, DMARC and MX checks for every sending domain, with clear fixes." },
  { icon: Sparkles, title: "AI sequences", body: "Describe your offer and get a multi-step sequence with spintax and personalization variables." },
  { icon: Inbox, title: "Unibox", body: "Every reply from every inbox in one place, auto-labelled by intent: interested, meeting, OOO and more." },
];

export default function Landing() {
  return (
    <main>
      <section className="bg-brand-gradient text-white">
        <div className="container flex items-center justify-between py-6">
          <Logo light />
          <Link href="/login" className={cn(buttonVariants({ variant: "gold" }))}>
            Sign in
          </Link>
        </div>
        <div className="container pb-28 pt-16 text-center">
          <p className="mx-auto inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-gold-200">
            Smart outbound scales horizontally
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-semibold leading-tight tracking-tight">
            More inboxes. Lower volume each. <span className="text-gold-300">Better deliverability.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-royal-100">
            Send 10,000 emails a day as 200 inboxes sending 50 — with warm-up, DNS monitoring and randomized
            sending built in from day one.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/login" className={cn(buttonVariants({ variant: "gold", size: "lg" }))}>
              Start free <ArrowRight />
            </Link>
          </div>
        </div>
      </section>
      <section className="container -mt-14 grid gap-4 pb-24 md:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border bg-white p-6 shadow-sm">
            <f.icon className="h-6 w-6 text-royal-600" />
            <h3 className="mt-4 font-semibold text-royal-950">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
