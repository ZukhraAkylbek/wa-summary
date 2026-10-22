-- Seed: phones allowed to talk to the bot in private chat (digits only, no "+").
-- Add real users here or via SQL Editor:
--   insert into wa_allowed_users (phone, name) values ('996XXXXXXXXX', 'Имя') on conflict do nothing;
insert into wa_allowed_users (phone, name)
select phone, name from (values ('', '')) as v(phone, name)
where phone <> ''
on conflict (phone) do nothing;
