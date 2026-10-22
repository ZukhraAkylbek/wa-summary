-- The linked number is a personal account, so its own (fromMe) messages are real
-- conversation and must be stored. Only messages the bot itself sent via WAHA are
-- skipped: sendText returns the message id, we keep it here and match on webhook.
alter table wa_bot_replies add column if not exists message_id text;
create index if not exists wa_bot_replies_message_id on wa_bot_replies (message_id);
