import { describe, expect, it } from "vitest";
import { classifySmtpError } from "./sender";

const err = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);

describe("classifySmtpError", () => {
  it("hard bounce on RCPT 550", () => expect(classifySmtpError(err("550 5.1.1 User unknown", { responseCode: 550, command: "RCPT TO" }))).toBe("bounce"));
  it("auth failure", () => expect(classifySmtpError(err("535 Authentication failed", { responseCode: 535 }))).toBe("auth"));
  it("temporary failure retries", () => expect(classifySmtpError(err("451 try again later", { responseCode: 451 }))).toBe("retry"));
  it("network error retries", () => expect(classifySmtpError(err("connect ETIMEDOUT", { code: "ETIMEDOUT" }))).toBe("retry"));
  it("550 on DATA for policy is not a bounce", () => expect(classifySmtpError(err("550 5.7.1 Message rejected as spam", { responseCode: 550, command: "DATA" }))).toBe("retry"));
});
