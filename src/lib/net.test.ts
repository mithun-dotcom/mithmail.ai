import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateIp } from "./net";

describe("isPrivateIp", () => {
  it.each(["10.1.2.3", "127.0.0.1", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"])("%s is private", (ip) =>
    expect(isPrivateIp(ip)).toBe(true));
  it.each(["8.8.8.8", "172.32.0.1", "2606:4700::1111"])("%s is public", (ip) => expect(isPrivateIp(ip)).toBe(false));
  it("rejects metadata endpoint", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest")).rejects.toThrow();
  });
});
