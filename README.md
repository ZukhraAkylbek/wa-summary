# WhatsApp group assistant (WAHA + Supabase + Claude)

Stores WhatsApp group messages, produces daily summaries, extracts tasks, answers when
mentioned, and shows everything in a web UI. UI, summaries and bot replies are in Russian.

```
WAHA (Docker) --webhook--> wa-webhook (Edge Fn) --> wa_messages / wa_chats
                                                 --> bot replies via WAHA /api/sendText   [step 2]
pg_cron 12:00 UTC ------> wa-daily-summary ------> Claude --> wa_summaries / wa_tasks
React UI (Supabase Auth + Realtime) reads the tables                                     [step 3]
```

## Layout
```
supabase/migrations/            all SQL (tables, RLS, realtime, cron helper)
supabase/functions/_shared/     env.ts, log.ts, supabase.ts, claude.ts, waha.ts
supabase/functions/wa-webhook/  WAHA webhook receiver (+ payload.ts normalizer)
supabase/functions/wa-daily-summary/  daily summary + task extraction (+ prompt.ts)
docker-compose.yml              WAHA Core
deploy.ps1                      link -> db push -> secrets -> deploy functions
dev/capture.ts                  local webhook sink to inspect real WAHA payloads
.env.example                    every variable, documented
```

## Status
- [x] Step 1: schema, webhook storing group messages, raw payload logging
- [ ] Step 2: bot (mentions, /summary /tasks /ask /task, private chat for allowed users)
- [ ] Step 3: web UI (tasks board, summaries, groups)

## Prerequisites
- Docker Desktop, Node.js 18+ (Supabase CLI runs through `npx`)
- A Supabase project: **project ref**, **service_role key**, **anon key**, and a
  [personal access token](https://supabase.com/dashboard/account/tokens)
- An LLM key: either an [Anthropic API key](https://console.anthropic.com) or a
  [Vercel AI Gateway](https://vercel.com/ai-gateway) key (`vck_...`; the Vercel team must have a
  credit card on file, otherwise every request returns 403 `customer_verification_required`)
- A dedicated phone number for the bot, member of the target groups

## Setup

### 1. Configure
```powershell
Copy-Item .env.example .env
# generate WEBHOOK_SECRET and WAHA_API_KEY:
-join ((1..40) | ForEach-Object { [char[]]"abcdefghijklmnopqrstuvwxyz0123456789"[(Get-Random -Max 36)] })
```
Fill `.env`. `BOT_PHONE` is the bot's own number, digits only.

### 2. WAHA up and QR login
```powershell
docker compose up -d
```
Open http://localhost:3000/dashboard (or `WAHA_PORT` from `.env`; login `admin` / `admin` unless overridden), start session
`default`, scan the QR with the bot's phone (WhatsApp -> Linked devices).

### 3. Supabase: migrations, secrets, functions
```powershell
.\deploy.ps1
```
Then once, in the SQL Editor, enable the daily schedule:
```sql
select wa_schedule_daily_summary('<PROJECT_REF>', '<SERVICE_ROLE_KEY>');
```

### 4. Web UI
Step 3, not yet built.

## Inspecting real WAHA payloads (before enabling bot logic)
Field names differ between WAHA engines, so don't guess. Two ways:

**A. Without Supabase (fastest).** Run the local sink and point WAHA at it:
```powershell
npx --yes deno@2 run --allow-net --allow-env --allow-read --allow-write dev/capture.ts
$env:WHATSAPP_HOOK_URL="http://host.docker.internal:8787/webhook"; docker compose up -d
```
Send a few messages in a test group (plain text, an @mention of the bot, a reply, a photo),
then read `dev/captured-events.jsonl`.

**B. Through Supabase.** With `LOG_RAW_EVENTS=true` the webhook writes every event to
`wa_raw_events`. Query `select event, payload from wa_raw_events order by id desc limit 20;`.
Set `LOG_RAW_EVENTS=false` and `truncate wa_raw_events;` when done.

## Manual test checklist
1. Message in a test group -> row in `wa_messages`, chat in `wa_chats`.
2. `curl -X POST "https://<REF>.supabase.co/functions/v1/wa-daily-summary?hours=24" -H "Authorization: Bearer <SERVICE_ROLE_KEY>"`
   -> row in `wa_summaries`, rows in `wa_tasks`.
3. (step 2) "@bot что решили?" in the group -> reply within ~10 s; random message -> no reply.
4. (step 2) `/task ...` -> task appears in the UI via realtime.
5. (step 2) Private message from a number not in `wa_allowed_users` -> ignored.

## Configuration notes
- `wa_chats` is **opt-in**: new groups land with `enabled=false, bot_enabled=false`. Turn on
  summaries / bot replies per group in the UI or via SQL. Seeded groups live in
  `supabase/migrations/20261014000002_seed_chats.sql`.
- `POST_TO_GROUP=true` and bot replies require `WAHA_URL` reachable from the internet over
  https, protected by `WAHA_API_KEY`.
- RLS: Edge Functions use the service role. Authenticated UI users can read all tables and
  update `wa_tasks` and `wa_chats`.
- After changing `.env`, re-run `.\deploy.ps1` to push secrets.

## Troubleshooting
- Empty `sender` / no rows: Dashboard -> Edge Functions -> `wa-webhook` -> Logs (JSON lines with
  `chat_id`, `message_id`). Adjust `supabase/functions/wa-webhook/payload.ts`.
- Summary did not run: `select * from cron.job_run_details order by start_time desc limit 10;`
  and `wa-daily-summary` logs.
