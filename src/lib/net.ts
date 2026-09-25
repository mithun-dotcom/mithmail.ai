import { promises as dns } from "node:dns";
import { isIP } from "node:net";

/** True for loopback, private (RFC 1918 / ULA), link-local, CGNAT and unspecified addresses. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Rejects URLs that resolve to internal addresses (SSRF guard for user-supplied webhook URLs). */
export async function assertPublicUrl(raw: string): Promise<void> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) URLs are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(isPrivateIp)) throw new Error("Webhook URL resolves to a private address");
}
