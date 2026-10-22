-- Raw group messages received from WAHA via the wa-webhook function
create table if not exists wa_messages (
  id text primary key,
  chat_id text not null,
  sender text,
  body text,
  ts timestamptz not null,
  created_at timestamptz default now()
);
create index if not exists wa_messages_chat_ts on wa_messages (chat_id, ts desc);

-- Daily summaries, one row per chat per day
create table if not exists wa_summaries (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  day date not null,
  summary text not null,
  messages_count int,
  created_at timestamptz default now(),
  unique (chat_id, day)
);

-- Tasks extracted by Claude from summaries (or created via the bot)
create table if not exists wa_tasks (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid references wa_summaries(id) on delete cascade,
  chat_id text not null,
  title text not null,
  description text,
  assignee text,
  due date,
  priority text default 'normal',
  status text default 'todo',
  created_at timestamptz default now()
);

-- Edge Functions use the service role and bypass RLS.
-- Policies for UI users live in a later migration.
alter table wa_messages  enable row level security;
alter table wa_summaries enable row level security;
alter table wa_tasks     enable row level security;
