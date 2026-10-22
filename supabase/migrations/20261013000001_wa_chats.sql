-- Group registry. The webhook inserts chat_id automatically; name is set in the UI.
--   enabled      -> include the group in the daily summary
--   bot_enabled  -> allow the bot to reply in this group
-- OPT-IN: both are false by default. The linked account is a personal number with ~40
-- groups, so only explicitly enabled groups are summarized or answered.
create table if not exists wa_chats (
  chat_id text primary key,
  name text,
  enabled boolean not null default false,
  bot_enabled boolean not null default false,
  last_seen timestamptz,
  created_at timestamptz default now()
);

alter table wa_chats enable row level security;
