import { describe, expect, it } from "vitest";
import { espFromMx, evaluateDkim, evaluateDmarc, evaluateSpf } from "./dns";

describe("evaluateSpf", () => {
  it("flags missing", () => expect(evaluateSpf(["google-site-verification=abc"]).status).toBe("MISSING"));
  it("accepts a normal record", () => {
    const r = evaluateSpf(["v=spf1 include:_spf.google.com ~all"]);
    expect(r.status).toBe("VALID");
    expect(r.issues).toHaveLength(0);
  });
  it("rejects duplicate records", () =>
    expect(evaluateSpf(["v=spf1 include:a.com ~all", "v=spf1 include:b.com -all"]).status).toBe("INVALID"));
  it("rejects +all", () => expect(evaluateSpf(["v=spf1 +all"]).status).toBe("INVALID"));
  it("warns without all", () => {
    const r = evaluateSpf(["v=spf1 include:_spf.google.com"]);
    expect(r.status).toBe("VALID");
    expect(r.issues[0]).toMatch(/terminating/);
  });
});

describe("evaluateDmarc", () => {
  it("flags missing", () => expect(evaluateDmarc([]).status).toBe("MISSING"));
  it("accepts quarantine", () => expect(evaluateDmarc(["v=DMARC1; p=quarantine; rua=mailto:x@y.com"]).issues).toHaveLength(0));
  it("notes p=none", () => expect(evaluateDmarc(["v=DMARC1; p=none"]).issues).toHaveLength(1));
  it("rejects no policy", () => expect(evaluateDmarc(["v=DMARC1; rua=mailto:x@y.com"]).status).toBe("INVALID"));
});

describe("evaluateDkim", () => {
  it("valid key", () => expect(evaluateDkim(["v=DKIM1; k=rsa; p=MIGfMA0"]).status).toBe("VALID"));
  it("revoked key", () => expect(evaluateDkim(["v=DKIM1; p="]).status).toBe("INVALID"));
  it("missing", () => expect(evaluateDkim([]).status).toBe("MISSING"));
});

describe("espFromMx", () => {
  it("google", () => expect(espFromMx(["aspmx.l.google.com"])).toBe("GOOGLE"));
  it("microsoft", () => expect(espFromMx(["acme-com.mail.protection.outlook.com"])).toBe("MICROSOFT"));
  it("other", () => expect(espFromMx(["mx.zoho.com"])).toBe("OTHER"));
  it("unknown", () => expect(espFromMx([])).toBe("UNKNOWN"));
});
