/**
 * SalesBlink public API client (https://developer.salesblink.io, spec in docs/salesblink-openapi.json).
 *
 * - Auth: `Authorization: <api key>`; a key is bound to exactly one SalesBlink workspace.
 * - Rate limits (per key): GET 30/min, POST+PATCH 15/min, PUT+DELETE 10/min. We stay just under
 *   them with a Redis fixed-window limiter shared by every process, and retry 429/5xx.
 */
import { sha256 } from "@/lib/crypto";
import { redis } from "@/server/queue";

export const SALESBLINK_BASE_URL = () => (process.env.SALESBLINK_API_URL ?? "https://run.salesblink.io/api/public/v1.0.0").replace(/\/$/, "");

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const TIER_LIMIT: Record<"read" | "write" | "restricted", number> = { read: 28, write: 14, restricted: 9 };
const tierOf = (m: Method) => (m === "GET" ? "read" : m === "POST" || m === "PATCH" ? "write" : "restricted");

export class SalesBlinkError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Response shapes (only the fields MithMill uses) ------------------------

export interface SbSender {
  id: string;
  email: string;
  name?: string;
  provider?: string;
  raw: Record<string, unknown>;
}
export interface SbSenderHealth {
  sender_id: string;
  email: string;
  sending_enabled: boolean;
  receiving_enabled: boolean;
  warmup_enabled: boolean;
  connected: boolean;
  error?: unknown;
  health_score: number;
  bounce_rate: number;
  reply_rate: number;
  last_7_days?: { sent: number; bounced: number; replies: number };
  warmup_30_days?: { sent: number; replies: number };
}
export interface SbWarmupDay {
  date: string;
  sent: number;
  sent_replies: number;
  received: number;
  received_replies: number;
  spam_to_inbox: number;
}
export interface SbActivity {
  id: string;
  time: number;
  message?: string;
  type?: string;
  sequence?: string;
  email: string;
  sequence_name?: string;
  template_name?: string;
}
export interface SbInboxItem {
  id: string;
  messageId: string;
  task_type?: string;
  email: string;
  data?: { email?: { subject?: string; body?: string } };
  scheduled_time?: number;
  unread?: boolean;
  sender?: string;
}
export interface SbSequenceLead {
  lead_id: string;
  email: string;
  status?: string;
  last_task_time?: number;
}
export interface SbSendingHour {
  name: string;
  enabled: boolean;
  fromTime: string;
  toTime: string;
}
export interface SbCreateSequence {
  name: string;
  senders: string; // comma-separated sender ids
  lists: string[];
  steps: ({ type: "email"; template_id: string } | { type: "delay"; days: number })[];
  launchTimingMode?: "now" | "schedule";
  scheduledAt?: number;
  timezone?: string;
  paused?: boolean;
  delayEnabled?: boolean;
  delayFrom?: number;
  delayTo?: number;
  stopWhenReplyRecieved?: boolean; // (sic) SalesBlink's spelling
  stopWhenReplyRecievedWhen?: "contact" | "contact-with-same-domain";
  autoPause?: boolean;
  plainText?: boolean;
  matchProvider?: boolean;
  auto_reply?: boolean;
  checkEmailBeforeSending?: boolean;
  emailSendingHours?: SbSendingHour[];
}

/** Picks the first present string field — sender objects are untyped in the spec. */
function str(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function idOf(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if ((typeof v === "string" && v) || typeof v === "number") return String(v);
  }
  return undefined;
}

/** First email-looking string: preferred keys first, then any field (one level deep). */
function emailOf(o: Record<string, unknown>): string | undefined {
  const preferred = str(o, "email", "from_email", "fromEmail", "email_address", "emailAddress", "sender_email", "user_name", "username", "user");
  if (preferred && EMAIL_RX.test(preferred)) return preferred;
  for (const v of Object.values(o)) {
    if (typeof v === "string" && EMAIL_RX.test(v)) return v;
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = emailOf(v as Record<string, unknown>);
      if (inner) return inner;
    }
  }
  return undefined;
}

export function normalizeSender(raw: Record<string, unknown>): SbSender | null {
  const id = idOf(raw, "id", "_id", "sender_id", "senderId", "uuid");
  const email = emailOf(raw)?.toLowerCase();
  if (!id || !email) return null;
  return { id, email, name: str(raw, "from_name", "fromName", "name", "sender_name"), provider: str(raw, "provider", "type", "service", "email_type", "account_type"), raw };
}

/** Pulls the list out of whatever envelope SalesBlink used ({data: [...]}, {data: {senders: [...]}}, [...], …). */
export function extractList(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  if (!res || typeof res !== "object") return [];
  const o = res as Record<string, unknown>;
  for (const k of ["data", "senders", "result", "results", "items", "docs", "rows"]) {
    const v = o[k];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
    if (v && typeof v === "object") {
      const inner = extractList(v);
      if (inner.length) return inner;
    }
  }
  return [];
}

export class SalesBlinkClient {
  private keyId: string;

  constructor(private apiKey: string) {
    if (!apiKey) throw new Error("SalesBlink API key is missing");
    this.keyId = sha256(apiKey).slice(0, 16);
  }

  /** Blocks until this key has budget left in the current minute for the method's tier. */
  private async acquire(method: Method) {
    const tier = tierOf(method);
    let r: Awaited<ReturnType<typeof redis>> | null = null;
    try {
      r = await redis();
    } catch {
      return; // no Redis (e.g. a one-off script): rely on 429 handling
    }
    for (;;) {
      const minute = Math.floor(Date.now() / 60_000);
      const key = `mm:sb:rl:${this.keyId}:${tier}:${minute}`;
      const n = await r.incr(key);
      if (n === 1) await r.expire(key, 90);
      if (n <= TIER_LIMIT[tier]) return;
      await sleep((minute + 1) * 60_000 - Date.now() + 250 + Math.random() * 1000);
    }
  }

  async request<T = unknown>(
    method: Method,
    path: string,
    opts: { query?: Record<string, string | number | boolean | undefined>; json?: unknown; form?: FormData } = {},
  ): Promise<T> {
    const url = new URL(SALESBLINK_BASE_URL() + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

    for (let attempt = 1; ; attempt++) {
      await this.acquire(method);
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: { Authorization: this.apiKey, Accept: "application/json", ...(opts.json !== undefined ? { "Content-Type": "application/json" } : {}) },
          body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        if (attempt < 3) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new SalesBlinkError(0, `SalesBlink unreachable: ${(e as Error).message}`);
      }
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        /* keep text */
      }
      if (res.ok) {
        // Some endpoints return 200 with { success: false, message }.
        if (body && typeof body === "object" && (body as { success?: boolean }).success === false) {
          throw new SalesBlinkError(res.status, (body as { message?: string }).message ?? "SalesBlink request failed", body);
        }
        return body as T;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : res.status === 429 ? 20_000 : 2000 * attempt);
        continue;
      }
      const message =
        (body && typeof body === "object" && ((body as { message?: string; error?: string }).message ?? (body as { error?: string }).error)) ||
        `${res.status} ${res.statusText}`;
      throw new SalesBlinkError(res.status, `SalesBlink ${method} ${path}: ${message}`, body);
    }
  }

  // ---- Account ---------------------------------------------------------------

  verify() {
    return this.request<{ success: boolean; message?: string }>("GET", "/account/verify");
  }

  // ---- Senders ---------------------------------------------------------------

  /**
   * All senders in the workspace. SalesBlink caps pages at 100; paging is by `skip`, but if a
   * page comes back with nothing new (the offset was ignored) we retry that page with `page`
   * and stop once neither yields new senders, so we never loop on the same 100.
   */
  async listSenders(opts: { search?: string } = {}): Promise<SbSender[]> {
    const byId = new Map<string, SbSender>();
    const limit = 100;
    const fetchPage = async (query: Record<string, string | number>) => {
      const res = await this.request<unknown>("GET", "/senders", { query: { limit, ...(opts.search ? { search: opts.search } : {}), ...query } });
      const page = extractList(res);
      let dropped = 0;
      let added = 0;
      for (const raw of page) {
        const s = normalizeSender(raw);
        if (!s) dropped++;
        else if (!byId.has(s.id)) {
          byId.set(s.id, s);
          added++;
        }
      }
      if (dropped) {
        // Shape diagnostics only (field names and value types, never values).
        const shape = (o: unknown) =>
          o && typeof o === "object" ? Object.fromEntries(Object.entries(o as object).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : typeof v])) : typeof o;
        console.warn(JSON.stringify({ msg: "salesblink /senders shape", dropped, pageSize: page.length, envelope: shape(res), firstItem: shape(page[0]) }));
      }
      return { size: page.length, added };
    };
    for (let n = 0; n < 100; n++) {
      let { size, added } = await fetchPage({ skip: n * limit });
      if (n > 0 && size > 0 && added === 0) ({ size, added } = await fetchPage({ page: n + 1 }));
      if (size < limit || added === 0) break;
    }
    return [...byId.values()];
  }

  /** Looks a sender up by email (SalesBlink's `search` filter), without paging the whole list. */
  async findSenderByEmail(email: string): Promise<SbSender | null> {
    const want = email.trim().toLowerCase();
    const hits = await this.listSenders({ search: want });
    return hits.find((s) => s.email === want) ?? null;
  }

  senderHealth(id: string) {
    return this.request<{ data: SbSenderHealth }>("GET", `/senders/${encodeURIComponent(id)}/health`).then((r) => r.data);
  }

  senderWarmupStats(id: string, days = 30) {
    return this.request<{ data: SbWarmupDay[] }>("GET", `/senders/${encodeURIComponent(id)}/warmup-stats`, { query: { days } }).then((r) => r.data ?? []);
  }

  updateSender(id: string, patch: Record<string, unknown>) {
    return this.request("PATCH", `/senders/${encodeURIComponent(id)}`, { json: patch });
  }

  addSender(input: Record<string, unknown>) {
    return this.request<{ success: boolean; message?: string }>("POST", "/senders/add-sender", { json: input });
  }

  /** CSV columns: from_email,password,smtp_host,smtp_port[,from_name,user_name,imap_host,imap_port,…] */
  addBulkSenders(csv: string) {
    const form = new FormData();
    form.set("csvFile", new Blob([csv], { type: "text/csv" }), "senders.csv");
    return this.request<{ success: boolean; message?: string }>("POST", "/senders/add-bulk-senders", { form });
  }

  reconnectSender(id: string) {
    return this.request("POST", `/senders/${encodeURIComponent(id)}/reconnect`);
  }

  connectLink() {
    return this.request<{ data: { login_link: string } }>("GET", "/senders/connect-link").then((r) => r.data.login_link);
  }

  // ---- Lists & leads ---------------------------------------------------------

  createList(name: string) {
    return this.request<{ data: { id: string } }>("POST", "/lists", { json: { name } }).then((r) => r.data.id);
  }

  /** Max 500 per call; field names must be snake_case. */
  addContacts(listId: string, contacts: Record<string, string>[]) {
    return this.request("POST", "/contacts", { json: { list_id: listId, contacts, remove_duplicates: true } });
  }

  removeContact(listId: string, email: string) {
    return this.request("POST", "/contacts/remove", { json: { list_id: listId, email } });
  }

  // ---- Templates -------------------------------------------------------------

  createTemplate(input: { name: string; subject: string; content: string }) {
    const form = new FormData();
    form.set("name", input.name);
    form.set("subject_line", input.subject);
    form.set("content", input.content);
    return this.request<{ data: { id: string } }>("POST", "/templates", { form }).then((r) => r.data.id);
  }

  updateTemplate(id: string, input: { subject?: string; content?: string }) {
    const form = new FormData();
    if (input.subject !== undefined) form.set("subject_line", input.subject);
    if (input.content !== undefined) form.set("content", input.content);
    return this.request("PATCH", `/templates/${encodeURIComponent(id)}`, { form });
  }

  // ---- Sequences -------------------------------------------------------------

  createSequence(input: SbCreateSequence) {
    return this.request<{ data: { id: string } }>("POST", "/sequences", { json: input }).then((r) => r.data.id);
  }

  updateSequence(id: string, patch: Partial<SbCreateSequence>) {
    return this.request("PATCH", `/sequences/${encodeURIComponent(id)}`, { json: patch });
  }

  setSequenceStatus(id: string, status: "ACTIVE" | "PAUSED" | "STOPPED" | "ARCHIVED") {
    return this.request("POST", `/sequences/${encodeURIComponent(id)}/status`, { json: { status } });
  }

  sequenceStats(id: string) {
    return this.request<{ data: Record<string, number | string> }>("GET", `/sequences/${encodeURIComponent(id)}/stats`).then((r) => r.data);
  }

  async sequenceLeads(id: string): Promise<SbSequenceLead[]> {
    const out: SbSequenceLead[] = [];
    const limit = 500;
    for (let skip = 0; skip < 200_000; skip += limit) {
      const res = await this.request<{ data?: SbSequenceLead[] }>("GET", `/sequences/${encodeURIComponent(id)}/leads`, { query: { limit, skip } });
      out.push(...(res.data ?? []));
      if ((res.data ?? []).length < limit) break;
    }
    return out;
  }

  removeLeadFromSequence(sequenceId: string, leadId: string) {
    return this.request("POST", `/sequences/${encodeURIComponent(sequenceId)}/leads/${encodeURIComponent(leadId)}/unsubscribe`);
  }

  // ---- Activity --------------------------------------------------------------

  /** Pages through sent / opens / clicks / replies events since `since` (Unix ms). */
  async activity(kind: "sent" | "opens" | "clicks" | "replies", since: number, maxPages = 20): Promise<SbActivity[]> {
    const out: SbActivity[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.request<SbActivity[] | { data?: SbActivity[] }>("GET", `/${kind}`, { query: { since, per_page: 100, page } });
      const rows = Array.isArray(res) ? res : (res.data ?? []);
      out.push(...rows);
      if (rows.length < 100) break;
    }
    return out;
  }

  // ---- Inbox -----------------------------------------------------------------

  inbox(params: { from: number; to: number; skip?: number; limit?: number }) {
    return this.request<{ data: { totalCount: number; result: SbInboxItem[] } }>("GET", "/inbox", {
      query: { date: `${params.from}-${params.to}`, limit: params.limit ?? 100, skip: params.skip ?? 0 },
    }).then((r) => r.data);
  }

  thread(messageId: string) {
    return this.request<{ data: { id: string; task_type?: string; data?: Record<string, unknown>; scheduled_time?: number }[] }>(
      "GET",
      `/inbox/${encodeURIComponent(messageId)}/thread`,
    ).then((r) => r.data ?? []);
  }

  reply(messageId: string, html: string) {
    return this.request("POST", `/inbox/${encodeURIComponent(messageId)}/reply`, { json: { content: html } });
  }

  updateMail(messageId: string, patch: { unread?: boolean; outcome?: string }) {
    return this.request("PATCH", `/inbox/${encodeURIComponent(messageId)}`, { json: patch });
  }

  // ---- Blocklist -------------------------------------------------------------

  addToBlocklist(entries: string[]) {
    return this.request("POST", "/unsubscribe", { json: { emails: entries } });
  }
}
