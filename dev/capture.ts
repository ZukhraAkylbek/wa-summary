// Dev tool: local webhook sink to inspect real WAHA payloads before writing bot logic.
// Appends every POST to dev/captured-events.jsonl and prints a short line.
//
//   npx --yes deno@2 run --allow-net --allow-env --allow-read --allow-write dev/capture.ts
//   WHATSAPP_HOOK_URL=http://host.docker.internal:8787/webhook docker compose up -d
const PORT = Number(Deno.env.get("PORT") ?? 8787);
const OUT = new URL("./captured-events.jsonl", import.meta.url);

let n = 0;
Deno.serve({ port: PORT }, async (req) => {
  if (req.method !== "POST") return new Response("capture ok");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  n++;
  const ev = body as { event?: string; payload?: Record<string, unknown> };
  await Deno.writeTextFile(OUT, JSON.stringify({ received_at: new Date().toISOString(), ...ev }) + "\n", { append: true });
  const p = ev.payload ?? {};
  console.log(`#${n} ${ev.event}  from=${p.from} to=${p.to} fromMe=${p.fromMe} body=${JSON.stringify(p.body ?? "").slice(0, 60)}`);
  return Response.json({ ok: true });
});
console.log(`capturing WAHA webhooks on http://localhost:${PORT}/webhook -> ${OUT.pathname}`);
