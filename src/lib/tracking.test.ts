import { beforeAll, describe, expect, it } from "vitest";
import { clickUrl, injectPixel, linkify, rewriteLinks, sign, verify } from "./tracking";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

describe("tracking", () => {
  it("signs and verifies", () => {
    const s = sign("abc");
    expect(verify("abc", s)).toBe(true);
    expect(verify("abd", s)).toBe(false);
    expect(verify("abc", "short")).toBe(false);
  });
  it("rewrites http links only", () => {
    const html = '<p><a href="https://acme.com/x?a=1&amp;b=2">x</a> <a href="mailto:a@b.c">m</a></p>';
    const out = rewriteLinks(html, "https://t.example.com", "log1");
    expect(out).toContain("https://t.example.com/t/c/log1?u=");
    expect(out).toContain(encodeURIComponent("https://acme.com/x?a=1&b=2"));
    expect(out).toContain('href="mailto:a@b.c"');
  });
  it("click url is verifiable", () => {
    const u = new URL(clickUrl("https://t.x", "L", "https://a.com"));
    expect(verify(`L|${u.searchParams.get("u")}`, u.searchParams.get("s")!)).toBe(true);
  });
  it("linkifies bare urls", () => {
    expect(linkify("<p>see https://acme.com/demo.</p>")).toBe('<p>see <a href="https://acme.com/demo">https://acme.com/demo</a>.</p>');
  });
  it("injects pixel", () => {
    expect(injectPixel("<p>x</p>", "U")).toMatch(/<p>x<\/p><img src="U"/);
  });
});
