import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const s = process.env.AUTH_SECRET ?? process.env.ENCRYPTION_KEY;
  if (!s) throw new Error("AUTH_SECRET is required for link signing");
  return s;
}

export function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url").slice(0, 22);
}

export function verify(value: string, signature: string): boolean {
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function trackingBaseUrl(trackingDomain?: { domainName: string; cnameVerified: boolean } | null): string {
  if (trackingDomain?.cnameVerified) return `https://${trackingDomain.domainName}`;
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function openPixelUrl(base: string, logId: string) {
  return `${base}/t/o/${logId}`;
}

export function clickUrl(base: string, logId: string, target: string) {
  return `${base}/t/c/${logId}?u=${encodeURIComponent(target)}&s=${sign(`${logId}|${target}`)}`;
}

export function unsubscribeUrl(base: string, logId: string) {
  return `${base}/t/u/${logId}?s=${sign(`unsub|${logId}`)}`;
}

/** Rewrites http(s) links in <a href> for click tracking (mailto: and anchors untouched). */
export function rewriteLinks(html: string, base: string, logId: string): string {
  return html.replace(/(<a\b[^>]*?\bhref=)(["'])(https?:\/\/[^"']+)\2/gi, (_m, pre: string, q: string, url: string) => {
    const decoded = url.replace(/&amp;/g, "&");
    return `${pre}${q}${clickUrl(base, logId, decoded).replace(/&/g, "&amp;")}${q}`;
  });
}

/** Turns bare URLs in plain-text-derived HTML into anchors so they can be tracked. */
export function linkify(html: string): string {
  return html.replace(/(^|[\s>(])(https?:\/\/[^\s<)"']+)/g, (_m, lead: string, raw: string) => {
    const url = raw.replace(/[.,!?;:]+$/, "");
    return `${lead}<a href="${url}">${url}</a>${raw.slice(url.length)}`;
  });
}

export function injectPixel(html: string, url: string): string {
  const img = `<img src="${url}" width="1" height="1" alt="" style="display:none;border:0;width:1px;height:1px" />`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${img}</body>`) : html + img;
}
