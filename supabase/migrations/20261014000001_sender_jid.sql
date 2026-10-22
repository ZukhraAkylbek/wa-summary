-- Real WAHA payloads carry senders as "<n>@lid", not phone numbers. Keep the raw jid so
-- names/phones can be resolved later (WAHA GET /api/{session}/lids/{lid}) without losing data.
alter table wa_messages add column if not exists sender_jid text;
create index if not exists wa_messages_sender_jid on wa_messages (sender_jid);
