/** Local wall-clock parts for `date` in IANA timezone `tz`. */
export function localParts(date: Date, tz: string): { weekday: number; hhmm: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hour = Number(get("hour"));
  return { weekday, hour, hhmm: `${String(hour).padStart(2, "0")}:${get("minute")}` };
}

export function isWithinWindow(
  date: Date,
  tz: string,
  schedule: { daysOfWeek: number[]; startTime: string; endTime: string },
): boolean {
  const { weekday, hhmm } = localParts(date, tz);
  return schedule.daysOfWeek.includes(weekday) && hhmm >= schedule.startTime && hhmm < schedule.endTime;
}

export function timeOfDay(date: Date, tz: string): "morning" | "afternoon" | "evening" {
  const { hour } = localParts(date, tz);
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

export function dayOfWeek(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(date);
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * Math.max(0, max - min);
}
