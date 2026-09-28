/**
 * Minimal in-process SalesBlink API that follows the response shapes in
 * docs/salesblink-openapi.json. Records every call for assertions.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";

export interface MockCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  auth: string | undefined;
}

export interface MockState {
  senders: { id: string; email: string; from_name: string }[];
  lists: Map<string, { name: string; contacts: Record<string, string>[] }>;
  templates: Map<string, { name: string; subject_line: string; content: string }>;
  sequences: Map<string, Record<string, unknown> & { status: string }>;
  activity: Record<"sent" | "opens" | "clicks" | "replies", { id: string; time: number; email: string; sequence: string; message?: string }[]>;
  inbox: { id: string; messageId: string; email: string; data: { email: { subject: string; body: string } }; scheduled_time: number; unread: boolean; sender: string }[];
  sequenceLeads: Map<string, { lead_id: string; email: string; status: string }[]>;
  replies: { messageId: string; content: string }[];
  mailUpdates: { messageId: string; patch: unknown }[];
  senderPatches: { id: string; patch: unknown }[];
  blocklist: string[];
  workspaces: { id: string; name: string }[];
  bulkUploads: string[];
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  const type = req.headers["content-type"] ?? "";
  if (type.includes("application/json")) return raw ? JSON.parse(raw) : {};
  if (type.includes("multipart/form-data")) {
    const boundary = /boundary=(.+)$/.exec(type)?.[1];
    const out: Record<string, string> = {};
    for (const part of raw.split(`--${boundary}`)) {
      const name = /name="([^"]+)"/.exec(part)?.[1];
      if (!name) continue;
      out[name] = part.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
    }
    return out;
  }
  return raw;
}

export async function startSalesblinkMock(apiKey: string | string[]) {
  const keys = new Set(Array.isArray(apiKey) ? apiKey : [apiKey]);
  const calls: MockCall[] = [];
  const state: MockState = {
    senders: [
      { id: "snd_google", email: "sam@trysend.io", from_name: "Sam" },
      { id: "snd_smtp", email: "alex@getsend.io", from_name: "Alex" },
    ],
    lists: new Map(),
    templates: new Map(),
    sequences: new Map(),
    activity: { sent: [], opens: [], clicks: [], replies: [] },
    inbox: [],
    sequenceLeads: new Map(),
    replies: [],
    mailUpdates: [],
    senderPatches: [],
    blocklist: [],
    workspaces: [],
    bulkUploads: [],
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname.replace(/^\/api\/public\/v1\.0\.0/, "");
    const body = await readBody(req);
    calls.push({ method: req.method ?? "", path, query: Object.fromEntries(url.searchParams), body, auth: req.headers.authorization });
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    };
    if (!keys.has(req.headers.authorization ?? "")) return send(401, { success: false, message: "Invalid API key" });

    const m = req.method;
    let match: RegExpExecArray | null;
    if (m === "GET" && path === "/account/verify") return send(200, { success: true, message: "API key is valid" });
    if (m === "POST" && path === "/workspaces") {
      const name = (body as { name: string }).name;
      if (!name || name.length < 4) return send(400, { success: false, message: "Name must be at least 4 characters" });
      const ws = { id: `ws_${randomUUID().slice(0, 8)}`, name };
      state.workspaces.push(ws);
      return send(200, { success: true, data: ws });
    }
    if (m === "PATCH" && (match = /^\/workspaces\/([^/]+)$/.exec(path))) {
      const ws = state.workspaces.find((w) => w.id === match![1]);
      if (ws) ws.name = (body as { name: string }).name;
      return send(200, { success: true, message: "Updated" });
    }
    if (m === "GET" && path === "/keys/create-link") {
      return send(200, { success: true, data: { login_link: "https://run.salesblink.io/magic?token=abc", destination: "/account/integration/api", purpose: "api-keys" } });
    }
    if (m === "POST" && (match = /^\/oauth\/(google|outlook)$/.exec(path))) {
      return send(200, { success: true, data: { auth_url: `https://accounts.example/${match[1]}/authorize?client_id=${match[1] === "google" ? "123456-sbapp.apps.googleusercontent.com" : "9f1c2d3e-sb-ms-app"}&state=xyz` } });
    }
    if (m === "POST" && path === "/senders/add-bulk-senders") {
      state.bulkUploads.push(String((body as Record<string, string>).csvFile ?? ""));
      return send(200, { success: true, message: "Senders queued" });
    }
    if (m === "GET" && path === "/senders") return send(200, { success: true, data: state.senders.slice(Number(url.searchParams.get("skip") ?? 0)) });
    if (m === "GET" && (match = /^\/senders\/([^/]+)\/health$/.exec(path))) {
      const s = state.senders.find((x) => x.id === match![1]);
      return send(200, {
        success: true,
        data: { sender_id: s?.id, email: s?.email, sending_enabled: true, receiving_enabled: true, warmup_enabled: true, connected: true, health_score: s?.id === "snd_google" ? 92 : 71, bounce_rate: 1.2, reply_rate: 4.5, last_7_days: { sent: 120, bounced: 1, replies: 5 }, warmup_30_days: { sent: 300, replies: 90 } },
      });
    }
    if (m === "PATCH" && (match = /^\/senders\/([^/]+)$/.exec(path))) {
      state.senderPatches.push({ id: match[1], patch: body });
      return send(200, { success: true, message: "Sender updated" });
    }
    if (m === "POST" && path === "/lists") {
      const id = `lst_${randomUUID().slice(0, 8)}`;
      state.lists.set(id, { name: (body as { name: string }).name, contacts: [] });
      return send(200, { success: true, data: { id, name: (body as { name: string }).name, contacts_count: 0 } });
    }
    if (m === "POST" && path === "/contacts") {
      const b = body as { list_id: string; contacts: Record<string, string>[] };
      const list = state.lists.get(b.list_id);
      if (!list) return send(404, { success: false, message: "List not found" });
      if (b.contacts.length > 500) return send(400, { success: false, message: "Max 500" });
      for (const c of b.contacts) {
        if (Object.keys(c).some((k) => !/^[a-z0-9_]+$/.test(k))) return send(400, { success: false, message: "Field names must be snake_case" });
      }
      list.contacts.push(...b.contacts);
      return send(200, { success: true });
    }
    if (m === "POST" && path === "/templates") {
      const b = body as { name: string; subject_line: string; content: string };
      const id = `tpl_${randomUUID().slice(0, 8)}`;
      state.templates.set(id, b);
      return send(200, { success: true, data: { id, name: b.name, cold_email_score: { score: 90, rating: "good" } } });
    }
    if (m === "POST" && path === "/sequences") {
      const id = `seq_${randomUUID().slice(0, 8)}`;
      const b = body as Record<string, unknown>;
      state.sequences.set(id, { ...b, status: b.paused === false ? "ACTIVE" : "PAUSED" });
      return send(200, { success: true, message: "Sequence created successfully.", data: { id, name: b.name, paused: b.paused } });
    }
    if (m === "POST" && (match = /^\/sequences\/([^/]+)\/status$/.exec(path))) {
      const seq = state.sequences.get(match[1]);
      if (!seq) return send(404, { success: false, message: "Sequence not found" });
      seq.status = (body as { status: string }).status;
      return send(200, { success: true, data: { sequence_id: match[1], status: seq.status } });
    }
    if (m === "GET" && (match = /^\/sequences\/([^/]+)\/leads$/.exec(path))) {
      return send(200, { success: true, data: state.sequenceLeads.get(match[1]) ?? [], count: 0, total: 0 });
    }
    if (m === "GET" && ["/sent", "/opens", "/clicks", "/replies"].includes(path)) {
      const since = Number(url.searchParams.get("since") ?? 0);
      const kind = path.slice(1) as keyof MockState["activity"];
      return send(200, state.activity[kind].filter((e) => e.time >= since));
    }
    if (m === "GET" && path === "/inbox") {
      const [from, to] = (url.searchParams.get("date") ?? "0-9999999999999").split("-").map(Number);
      const result = state.inbox.filter((i) => i.scheduled_time >= from && i.scheduled_time <= to);
      return send(200, { success: true, data: { totalCount: result.length, count: 0, messageIDs: result.map((r) => r.messageId), result } });
    }
    if (m === "POST" && (match = /^\/inbox\/([^/]+)\/reply$/.exec(path))) {
      state.replies.push({ messageId: match[1], content: (body as { content: string }).content });
      return send(200, { success: true, data: { id: randomUUID(), task_type: "reply", status: "scheduled" } });
    }
    if (m === "PATCH" && (match = /^\/inbox\/([^/]+)$/.exec(path))) {
      state.mailUpdates.push({ messageId: match[1], patch: body });
      return send(200, { success: true, message: "Updated", data: "ok" });
    }
    if (m === "POST" && path === "/unsubscribe") {
      state.blocklist.push(...(body as { emails: string[] }).emails);
      return send(200, { success: true, message: "Added" });
    }
    send(404, { success: false, message: `Mock: no route for ${m} ${path}` });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/api/public/v1.0.0`,
    calls,
    state,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
