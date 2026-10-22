// Structured logging: one JSON line per event, easy to filter in Supabase logs.
type Ctx = Record<string, unknown>;

function line(level: "info" | "warn" | "error", msg: string, ctx?: Ctx) {
  return JSON.stringify({ level, msg, ...ctx, at: new Date().toISOString() });
}

export const log = {
  info: (msg: string, ctx?: Ctx) => console.log(line("info", msg, ctx)),
  warn: (msg: string, ctx?: Ctx) => console.warn(line("warn", msg, ctx)),
  error: (msg: string, ctx?: Ctx) => console.error(line("error", msg, ctx)),
};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
