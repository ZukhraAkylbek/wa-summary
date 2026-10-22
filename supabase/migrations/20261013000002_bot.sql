-- Bot support: allowed private users, task provenance, rate limiting, raw event log.

-- Phones (digits only, no "+") allowed to talk to the bot in private chat
create table if not exists wa_allowed_users (
  phone text primary key,
  name text,
  created_at timestamptz default now()
);
alter table wa_allowed_users enable row level security;

-- Task provenance and value constraints
alter table wa_tasks add column if not exists source text not null default 'summary';
alter table wa_tasks drop constraint if exists wa_tasks_source_check;
alter table wa_tasks add constraint wa_tasks_source_check
  check (source in ('summary', 'bot'));
alter table wa_tasks drop constraint if exists wa_tasks_status_check;
alter table wa_tasks add constraint wa_tasks_status_check
  check (status in ('todo', 'in_progress', 'done'));
alter table wa_tasks drop constraint if exists wa_tasks_priority_check;
alter table wa_tasks add constraint wa_tasks_priority_check
  check (priority in ('low', 'normal', 'high', 'urgent'));
create index if not exists wa_tasks_chat_status on wa_tasks (chat_id, status);

-- Every bot reply, used for rate limiting (per chat / global)
create table if not exists wa_bot_replies (
  id bigserial primary key,
  chat_id text not null,
  trigger text,
  sent_at timestamptz not null default now()
);
create index if not exists wa_bot_replies_sent_at on wa_bot_replies (sent_at desc);
create index if not exists wa_bot_replies_chat_sent on wa_bot_replies (chat_id, sent_at desc);
alter table wa_bot_replies enable row level security;

-- Raw WAHA payloads, written only while LOG_RAW_EVENTS=true. Inspect, then truncate.
create table if not exists wa_raw_events (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  event text,
  payload jsonb not null
);
alter table wa_raw_events enable row level security;

-- UI users (Supabase Auth): read everything, update tasks and chats
drop policy if exists "authenticated read" on wa_messages;
create policy "authenticated read" on wa_messages for select to authenticated using (true);

drop policy if exists "authenticated read" on wa_summaries;
create policy "authenticated read" on wa_summaries for select to authenticated using (true);

drop policy if exists "authenticated read" on wa_tasks;
create policy "authenticated read" on wa_tasks for select to authenticated using (true);
drop policy if exists "authenticated update" on wa_tasks;
create policy "authenticated update" on wa_tasks for update to authenticated using (true) with check (true);

drop policy if exists "authenticated read" on wa_chats;
create policy "authenticated read" on wa_chats for select to authenticated using (true);
drop policy if exists "authenticated update" on wa_chats;
create policy "authenticated update" on wa_chats for update to authenticated using (true) with check (true);

drop policy if exists "authenticated read" on wa_allowed_users;
create policy "authenticated read" on wa_allowed_users for select to authenticated using (true);

-- Realtime for the UI
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'wa_tasks') then
    alter publication supabase_realtime add table wa_tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'wa_summaries') then
    alter publication supabase_realtime add table wa_summaries;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'wa_chats') then
    alter publication supabase_realtime add table wa_chats;
  end if;
end $$;
