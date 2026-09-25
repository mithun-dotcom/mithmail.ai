import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    name: "MithMill API",
    version: "v1",
    auth: "Authorization: Bearer <api key>",
    endpoints: {
      "GET /api/v1/campaigns": "List campaigns with stats",
      "POST /api/v1/campaigns/{id}/leads": "Add leads to a campaign: { leads: [{ email, firstName?, lastName?, companyName?, linkedinUrl?, customVariables? }] }",
      "GET /api/v1/leads?email=": "Look up a lead",
      "POST /api/v1/leads": "Create/update leads: { leads: [...], campaignId? }",
      "GET /api/v1/accounts": "List inboxes with health",
      "GET /api/v1/threads?label=INTERESTED": "List Unibox conversations",
      "POST /api/v1/blocklist": "Block emails/domains: { entries: string[] }",
    },
  });
}
