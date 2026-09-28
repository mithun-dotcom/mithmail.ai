import { describe, expect, it } from "vitest";
import { clientIdFromAuthUrl } from "./oauth-apps";

describe("clientIdFromAuthUrl", () => {
  it("reads client_id from Google and Microsoft auth URLs", () => {
    expect(
      clientIdFromAuthUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=1234-abc.apps.googleusercontent.com&scope=https%3A%2F%2Fmail.google.com%2F"),
    ).toBe("1234-abc.apps.googleusercontent.com");
    expect(clientIdFromAuthUrl("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=9f1c-uuid&response_type=code")).toBe("9f1c-uuid");
  });
  it("handles missing or malformed URLs", () => {
    expect(clientIdFromAuthUrl(undefined)).toBeNull();
    expect(clientIdFromAuthUrl("not a url")).toBeNull();
    expect(clientIdFromAuthUrl("https://x.io/auth")).toBeNull();
  });
});
