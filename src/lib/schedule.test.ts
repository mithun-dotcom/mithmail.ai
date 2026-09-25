import { describe, expect, it } from "vitest";
import { isWithinWindow, localParts, timeOfDay } from "./schedule";

const sched = { daysOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" };

describe("schedule", () => {
  it("converts to local time", () => {
    // 2026-09-25 is a Friday. 14:30 UTC = 10:30 in New York (EDT).
    const d = new Date("2026-09-25T14:30:00Z");
    expect(localParts(d, "America/New_York")).toMatchObject({ weekday: 5, hhmm: "10:30" });
  });
  it("respects window and days", () => {
    expect(isWithinWindow(new Date("2026-09-25T14:30:00Z"), "America/New_York", sched)).toBe(true);
    expect(isWithinWindow(new Date("2026-09-25T22:30:00Z"), "America/New_York", sched)).toBe(false); // 18:30
    expect(isWithinWindow(new Date("2026-09-26T14:30:00Z"), "America/New_York", sched)).toBe(false); // Saturday
  });
  it("handles timezones ahead of UTC crossing midnight", () => {
    // Sunday 2026-09-27 23:30 UTC = Monday 08:30 in Tokyo.
    const early = { ...sched, startTime: "08:00" };
    expect(isWithinWindow(new Date("2026-09-27T23:30:00Z"), "Asia/Tokyo", early)).toBe(true);
    expect(isWithinWindow(new Date("2026-09-27T23:30:00Z"), "UTC", early)).toBe(false);
  });
  it("end time is exclusive", () => {
    expect(isWithinWindow(new Date("2026-09-25T21:00:00Z"), "America/New_York", sched)).toBe(false);
  });
  it("time of day", () => {
    expect(timeOfDay(new Date("2026-09-25T14:30:00Z"), "America/New_York")).toBe("morning");
  });
});
