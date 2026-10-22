-- Opt-in defaults (explicit alter: the table may already exist with the old "true" defaults)
alter table wa_chats alter column enabled set default false;
alter table wa_chats alter column bot_enabled set default false;

-- Seed: groups enabled for summaries and bot replies (opt-in).
-- Add more rows here or toggle in the UI (Groups page).
insert into wa_chats (chat_id, name, enabled, bot_enabled) values
  ('120363412531928980@g.us', 'Virtual', true, true)
on conflict (chat_id) do update
  set name = coalesce(wa_chats.name, excluded.name),
      enabled = excluded.enabled,
      bot_enabled = excluded.bot_enabled;
