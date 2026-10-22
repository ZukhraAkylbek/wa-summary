// Typed access to environment variables.
export const env = {
  get(name: string): string | undefined {
    const v = Deno.env.get(name);
    return v === undefined || v === "" ? undefined : v;
  },
  required(name: string): string {
    const v = env.get(name);
    if (v === undefined) throw new Error(`Missing required env var ${name}`);
    return v;
  },
  bool(name: string, fallback = false): boolean {
    const v = env.get(name);
    return v === undefined ? fallback : v.toLowerCase() === "true";
  },
  int(name: string, fallback: number): number {
    const v = Number(env.get(name));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  },
};

export const TZ = "Asia/Bishkek";
