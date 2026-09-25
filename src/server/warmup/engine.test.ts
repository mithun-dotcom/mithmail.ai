import { describe, expect, it } from "vitest";
import { dailyWarmupTarget } from "./engine";

describe("dailyWarmupTarget", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  it("ramps up daily", () => {
    expect(dailyWarmupTarget({ warmupStartedAt: new Date("2026-09-25T08:00:00Z"), warmupRampUp: 2, warmupDailyLimit: 20 }, now)).toBe(2);
    expect(dailyWarmupTarget({ warmupStartedAt: new Date("2026-09-21T08:00:00Z"), warmupRampUp: 2, warmupDailyLimit: 20 }, now)).toBe(10);
  });
  it("caps at the daily limit", () => {
    expect(dailyWarmupTarget({ warmupStartedAt: new Date("2026-01-01T00:00:00Z"), warmupRampUp: 3, warmupDailyLimit: 25 }, now)).toBe(25);
  });
});
