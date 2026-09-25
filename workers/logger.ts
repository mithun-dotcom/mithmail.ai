type Meta = Record<string, unknown> | undefined;

function line(level: string, msg: string, meta: Meta) {
  const out = { t: new Date().toISOString(), level, msg, ...(meta ?? {}) };
  (level === "error" ? console.error : console.log)(JSON.stringify(out));
}

export const logger = {
  info: (msg: string, meta?: Meta) => line("info", msg, meta),
  warn: (msg: string, meta?: Meta) => line("warn", msg, meta),
  error: (msg: string, meta?: Meta) => line("error", msg, meta),
};
