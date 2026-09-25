"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Clock, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useSequence } from "@/stores/sequence-store";
import type { StepDraft } from "@/lib/campaign-types";
import { BUILTIN_VARIABLES, render, textToHtml } from "@/lib/template";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { aiWriteSequence, saveSequence } from "../../actions";

export function SequenceEditor({
  campaignId,
  initial,
  sample,
  aiEnabled,
}: {
  campaignId: string;
  initial: StepDraft[];
  sample: Record<string, string>;
  aiEnabled: boolean;
}) {
  const s = useSequence();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    s.init(initial.length ? initial : [{ stepNumber: 1, waitDays: 0, subject: "", body: "", variants: [] }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const step = s.steps[s.selected];
  const variant = step?.variants.find((v) => v.id === s.variant);
  const current = variant ?? step;

  const preview = useMemo(() => {
    if (!current) return { subject: "", html: "" };
    void seed; // re-roll spintax
    const vars = { ...sample, sender_name: "Jordan", signature: "" };
    const subject = render(current.subject || (s.selected > 0 ? `Re: ${s.steps[0]?.subject ?? ""}` : ""), vars);
    const body = render(current.body, vars);
    return { subject, html: /<[a-z][\s\S]*>/i.test(body) ? body : textToHtml(body) };
  }, [current, sample, seed, s.selected, s.steps]);

  if (!step || !current) return null;

  const patch = (p: { subject?: string; body?: string }) =>
    variant ? s.updateVariant(s.selected, variant.id, p) : s.update(s.selected, p);

  function insertVariable(name: string) {
    const el = bodyRef.current;
    const tag = name === "first_name" ? "{{first_name|there}}" : `{{${name}}}`;
    if (!el) return patch({ body: current!.body + tag });
    const { selectionStart: a, selectionEnd: b } = el;
    patch({ body: current!.body.slice(0, a) + tag + current!.body.slice(b) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + tag.length, a + tag.length);
    });
  }

  function save() {
    start(async () => {
      const res = await saveSequence(campaignId, s.steps);
      setStatus(res);
      if (res.ok) s.markSaved();
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]">
      {/* Step list */}
      <div className="flex min-w-0 flex-col gap-2">
        {s.steps.map((st, i) => (
          <div key={i} className="min-w-0">
            {i > 0 && (
              <div className="flex items-center gap-2 py-1 pl-4 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" /> wait
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={st.waitDays}
                  onChange={(e) => s.update(i, { waitDays: Number(e.target.value) })}
                  className="h-6 w-14 px-1 text-xs"
                />
                days
              </div>
            )}
            <button
              onClick={() => s.select(i)}
              className={cn(
                "w-full rounded-lg border bg-white p-3 text-left text-sm shadow-sm transition",
                i === s.selected ? "border-royal-500 ring-2 ring-royal-200" : "hover:border-royal-300",
              )}
            >
              <span className="text-xs font-medium uppercase tracking-wide text-royal-600">Step {i + 1}</span>
              {st.variants.length > 0 && <span className="ml-2 text-xs text-amber-700">A/B ×{st.variants.length + 1}</span>}
              <span className="block truncate font-medium">{st.subject || (i > 0 ? "(same thread)" : "No subject")}</span>
              <span className="block truncate text-xs text-muted-foreground">{st.body.slice(0, 60) || "Empty"}</span>
            </button>
          </div>
        ))}
        <Button variant="outline" onClick={s.addStep}>
          <Plus /> Add step
        </Button>
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={save} disabled={pending || !s.dirty} className="flex-1">
            {pending ? "Saving…" : s.dirty ? "Save sequence" : "Saved"}
          </Button>
        </div>
        {status.error && <p className="text-sm text-red-700">{status.error}</p>}
      </div>

      {/* Editor */}
      <Card className="min-w-0">
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex gap-1">
            {["A", ...step.variants.map((v) => v.id)].map((id) => (
              <button
                key={id}
                onClick={() => s.selectVariant(id)}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium", s.variant === id ? "bg-royal-600 text-white" : "bg-muted text-muted-foreground")}
              >
                Variant {id}
              </button>
            ))}
            {step.variants.length < 3 && (
              <button onClick={() => s.addVariant(s.selected)} className="rounded-md px-2 py-1 text-xs text-royal-700 hover:bg-royal-50">
                + A/B variant
              </button>
            )}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" title="Move up" onClick={() => s.moveStep(s.selected, -1)}><ArrowUp /></Button>
            <Button variant="ghost" size="icon" title="Move down" onClick={() => s.moveStep(s.selected, 1)}><ArrowDown /></Button>
            <Button
              variant="ghost"
              size="icon"
              title={variant ? "Delete variant" : "Delete step"}
              onClick={() => (variant ? s.removeVariant(s.selected, variant.id) : s.removeStep(s.selected))}
            >
              <Trash2 />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Subject</Label>
            <Input
              value={current.subject}
              onChange={(e) => patch({ subject: e.target.value })}
              placeholder={s.selected > 0 ? "Leave blank to reply in the same thread" : "{Quick question|Idea} for {{company_name}}"}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Body</Label>
            <Textarea
              ref={bodyRef}
              rows={14}
              value={current.body}
              onChange={(e) => patch({ body: e.target.value })}
              placeholder={"{Hi|Hey} {{first_name|there}},\n\nNoticed {{company_name}} is hiring SDRs…"}
              className="font-mono text-[13px]"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BUILTIN_VARIABLES.filter((v) => !["day_of_week", "time_of_day"].includes(v)).map((v) => (
              <button key={v} onClick={() => insertVariable(v)} className="rounded-full bg-royal-50 px-2 py-0.5 text-xs text-royal-700 hover:bg-royal-100">
                {`{{${v}}}`}
              </button>
            ))}
            {Object.keys(sample)
              .filter((k) => !BUILTIN_VARIABLES.includes(k))
              .map((k) => (
                <button key={k} onClick={() => insertVariable(k)} className="rounded-full bg-gold-100 px-2 py-0.5 text-xs text-amber-900 hover:bg-gold-200">
                  {`{{${k}}}`}
                </button>
              ))}
          </div>
          {variant && (
            <div className="flex items-center gap-2 text-sm">
              <Label>Traffic weight</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={variant.weight}
                onChange={(e) => s.updateVariant(s.selected, variant.id, { weight: Number(e.target.value) })}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">Variant A always has weight 50.</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Spintax: <code>{"{Hi|Hello|Hey}"}</code> · Variables: <code>{"{{first_name|fallback}}"}</code> · Your inbox signature is appended automatically.
          </p>
        </CardContent>
      </Card>

      {/* Preview + AI */}
      <div className="grid min-w-0 content-start gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Preview</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setSeed((n) => n + 1)}>
              <RefreshCw /> Re-spin
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">To: {sample.email}</p>
            <p className="mt-1 font-medium">{preview.subject || <span className="text-muted-foreground">(no subject)</span>}</p>
            <div className="prose-sm mt-3 space-y-3 text-sm [&_p]:leading-relaxed" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </CardContent>
        </Card>
        <AiWriter enabled={aiEnabled} onResult={(steps) => s.replaceAll(steps)} />
      </div>
    </div>
  );
}

function AiWriter({ enabled, onResult }: { enabled: boolean; onResult: (steps: StepDraft[]) => void }) {
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(3);
  const [spintax, setSpintax] = useState(true);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <Card className="border-gold-300 bg-gradient-to-b from-gold-100/60 to-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-gold-500" /> AI sequence writer
        </CardTitle>
        <CardDescription>Describe who you sell to and what you offer. Replaces the current steps.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="We help Series A SaaS companies book 20+ demos/month with done-for-you outbound. Target: VP Sales / founders. Offer a free pipeline audit."
          disabled={!enabled}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            Steps
            <Input type="number" min={1} max={7} value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-8 w-16" />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={spintax} onChange={(e) => setSpintax(e.target.checked)} /> Add spintax
          </label>
          <Button
            variant="gold"
            size="sm"
            className="ml-auto"
            disabled={!enabled || pending}
            onClick={() =>
              start(async () => {
                setError("");
                const res = await aiWriteSequence({ prompt, steps: count, useSpintax: spintax });
                if (res.error || !res.steps) return setError(res.error ?? "No result");
                onResult(res.steps.map((st, i) => ({ stepNumber: i + 1, waitDays: st.waitDays, subject: st.subject, body: st.body, variants: [] })));
              })
            }
          >
            {pending ? "Writing…" : "Generate"}
          </Button>
        </div>
        {!enabled && <p className="text-xs text-muted-foreground">Set OPENAI_API_KEY to enable.</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </CardContent>
    </Card>
  );
}
