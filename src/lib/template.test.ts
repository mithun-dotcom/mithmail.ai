import { describe, expect, it } from "vitest";
import { extractVariables, fillVariables, htmlToText, render, seededRng, spin, textToHtml } from "./template";

const first = () => 0; // always pick first option
const last = () => 0.9999;

describe("spin", () => {
  it("picks an option", () => {
    expect(spin("{Hi|Hello} there", first)).toBe("Hi there");
    expect(spin("{Hi|Hello} there", last)).toBe("Hello there");
  });
  it("handles nesting", () => {
    expect(spin("{a|{b|c}}", last)).toBe("c");
    expect(spin("x{1|2{3|4}}y", last)).toBe("x24y");
  });
  it("leaves variables untouched", () => {
    expect(spin("{Hi|Hey} {{first_name}}", first)).toBe("Hi {{first_name}}");
    expect(spin("{Hi {{first_name|there}}|Yo}", first)).toBe("Hi {{first_name|there}}");
  });
  it("tolerates unclosed braces", () => {
    expect(spin("price {oops", first)).toBe("price {oops");
  });
  it("allows empty options", () => {
    expect(spin("Hi{|!}", first)).toBe("Hi");
  });
  it("covers every option over many runs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(spin("{a|b|c}"));
    expect([...seen].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("fillVariables", () => {
  it("substitutes and normalises keys", () => {
    expect(fillVariables("Hi {{ first_name }} at {{companyName}}", { firstName: "Ana", company_name: "Acme" })).toBe("Hi Ana at Acme");
  });
  it("uses fallback when empty", () => {
    expect(fillVariables("Hi {{first_name|there}}", { first_name: "" })).toBe("Hi there");
    expect(fillVariables("Hi {{first_name|there}}", {})).toBe("Hi there");
  });
  it("drops unknown variables", () => {
    expect(fillVariables("A{{nope}}B", {})).toBe("AB");
  });
  it("supports custom CSV columns with spaces", () => {
    expect(fillVariables("{{Job Title}}", { "job title": "CTO" })).toBe("CTO");
  });
});

describe("render", () => {
  it("is deterministic with a seeded rng", () => {
    const t = "{Hi|Hello|Hey} {{first_name}}";
    expect(render(t, { first_name: "Bo" }, seededRng("lead-1"))).toBe(render(t, { first_name: "Bo" }, seededRng("lead-1")));
  });
  it("renders variables inside spintax", () => {
    expect(render("{Hi {{first_name}}|Hey}", { first_name: "Bo" }, first)).toBe("Hi Bo");
  });
});

describe("helpers", () => {
  it("extracts variables", () => {
    expect(extractVariables("{{first_name}} {{Company Name|x}} {{first_name}}")).toEqual(["first_name", "company_name"]);
  });
  it("text <-> html", () => {
    const html = textToHtml("Hi <b>\n\nLine1\nLine2");
    expect(html).toBe("<p>Hi &lt;b&gt;</p><p>Line1<br>Line2</p>");
    expect(htmlToText(html)).toBe("Hi <b>\n\nLine1\nLine2");
  });
});
