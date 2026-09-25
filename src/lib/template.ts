/**
 * MithMill template engine.
 *
 *   Spintax:    {Hi|Hello|Hey}            → one option picked at random (nestable)
 *   Variables:  {{first_name}}            → lead field / custom variable
 *               {{first_name|there}}      → with fallback when empty
 *   Built-ins:  {{sender_name}}, {{signature}}, {{day_of_week}}, {{time_of_day}}
 *
 * Variables are resolved AFTER spintax so option text may contain variables:
 *   "{Hi {{first_name}}|Hey there}"
 */

export type Rng = () => number;

/** Mulberry32 — small deterministic PRNG so a lead always sees the same variant. */
export function seededRng(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VAR_OPEN = "\u0001";
const VAR_CLOSE = "\u0002";
const VAR_BAR = "\u0003";

/** Expands spintax. `{{...}}` variable tags are left untouched. */
export function spin(input: string, rng: Rng = Math.random): string {
  // Protect variable tags from the spintax parser.
  const protectedInput = input.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) => `${VAR_OPEN}${inner.replace(/\|/g, VAR_BAR)}${VAR_CLOSE}`);

  let pos = 0;
  function parseSeq(stopAtBar: boolean): string {
    let out = "";
    while (pos < protectedInput.length) {
      const ch = protectedInput[pos];
      if (ch === "{") {
        pos++;
        out += parseGroup();
      } else if (ch === "}" && stopAtBar) {
        return out;
      } else if (ch === "|" && stopAtBar) {
        return out;
      } else {
        out += ch;
        pos++;
      }
    }
    return out;
  }
  function parseGroup(): string {
    const options: string[] = [];
    for (;;) {
      options.push(parseSeq(true));
      if (pos >= protectedInput.length) {
        // Unclosed brace: treat literally.
        return "{" + options.join("|");
      }
      const ch = protectedInput[pos++];
      if (ch === "}") break;
    }
    return options[Math.floor(rng() * options.length)] ?? "";
  }

  return parseSeq(false).replace(new RegExp(`${VAR_OPEN}([^${VAR_CLOSE}]*)${VAR_CLOSE}`, "g"), (_m, inner: string) => `{{${inner.replace(new RegExp(VAR_BAR, "g"), "|")}}}`);
}

export function normalizeKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

export type Vars = Record<string, string | number | null | undefined>;

/** Replaces {{var}} / {{var|fallback}} tags. Unknown variables without fallback become "". */
export function fillVariables(input: string, vars: Vars): string {
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(vars)) if (v !== null && v !== undefined && String(v).trim() !== "") lookup.set(normalizeKey(k), String(v));
  return input.replace(/\{\{\s*([^{}|]+?)\s*(?:\|([^{}]*))?\}\}/g, (_m, key: string, fallback?: string) => {
    return lookup.get(normalizeKey(key)) ?? (fallback ?? "").trim();
  });
}

export function render(input: string, vars: Vars, rng: Rng = Math.random): string {
  return fillVariables(spin(input, rng), vars);
}

/** Lists variable names referenced by a template (for validation / "missing data" warnings). */
export function extractVariables(input: string): string[] {
  const out = new Set<string>();
  for (const m of input.matchAll(/\{\{\s*([^{}|]+?)\s*(?:\|[^{}]*)?\}\}/g)) out.add(normalizeKey(m[1]));
  return [...out];
}

export const BUILTIN_VARIABLES = ["first_name", "last_name", "email", "company_name", "icebreaker", "linkedin_url", "sender_name", "signature", "day_of_week", "time_of_day"];

/** Plain text → minimal HTML (paragraphs + line breaks), escaping HTML. */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** HTML → readable plain text (for the text/plain MIME part and AI prompts). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
