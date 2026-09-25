import { describe, expect, it } from "vitest";
import { classifyReplyHeuristic } from "./ai";

describe("classifyReplyHeuristic", () => {
  it.each([
    ["I am out of the office until Monday", "OUT_OF_OFFICE"],
    ["Please remove me from your list", "UNSUBSCRIBE_REQUEST"],
    ["Jane no longer works here", "WRONG_PERSON"],
    ["Not interested, thanks", "NOT_INTERESTED"],
    ["Sounds good, tell me more", "INTERESTED"],
    ["Booked a slot on your calendly.com link", "MEETING_BOOKED"],
    ["ok", null],
  ])("%s → %s", (text, label) => {
    expect(classifyReplyHeuristic(text)).toBe(label);
  });
});
