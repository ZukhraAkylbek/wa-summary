-- Outbound bot replies queued when WAHA is not reachable from Edge Functions
-- (local Docker). A small worker on the host sends them via localhost.
create table if not exists wa_bot_jobs (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  trigger text,
  reply text not null,
  status text not null default 'pending',
  message_id text,
  error text,
  created_at timestamptz default now(),
  sent_at timestamptz
);
create index if not exists wa_bot_jobs_pending on wa_bot_jobs (created_at)
  where status = 'pending';
alter table wa_bot_jobs enable row level security;
drop policy if exists "authenticated read" on wa_bot_jobs;
create policy "authenticated read" on wa_bot_jobs for select to authenticated using (true);

alter table wa_bot_jobs drop constraint if exists wa_bot_jobs_status_check;
alter table wa_bot_jobs add constraint wa_bot_jobs_status_check
  check (status in ('pending', 'sent', 'failed'));
