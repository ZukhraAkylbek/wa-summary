import { useEffect, useState } from "react";
import { supabase, type Chat } from "../lib/supabase";

export function GroupsPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const { data, error: e } = await supabase
      .from("wa_chats")
      .select("chat_id,name,enabled,bot_enabled,last_seen")
      .order("last_seen", { ascending: false, nullsFirst: false });
    if (e) setError(e.message);
    else setChats((data ?? []) as Chat[]);
  }

  useEffect(() => { load(); }, []);

  async function save(chat: Chat, patch: Partial<Chat>) {
    const next = { ...chat, ...patch };
    setChats((all) => all.map((c) => c.chat_id === chat.chat_id ? next : c));
    const { error: e } = await supabase.from("wa_chats").update(patch).eq("chat_id", chat.chat_id);
    if (e) setError(e.message);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-stone-500">
        Сводки и ответы бота выключены, пока не включишь группу. Сейчас активна только та, где оба переключателя включены.
      </p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {chats.map((c) => (
        <article key={c.chat_id} className="rounded-2xl bg-white p-4">
          <input
            value={c.name ?? ""}
            placeholder="Название группы"
            onChange={(e) => setChats((all) => all.map((x) => x.chat_id === c.chat_id ? { ...x, name: e.target.value } : x))}
            onBlur={(e) => save(c, { name: e.target.value || null })}
            className="w-full text-lg font-medium outline-none"
          />
          <p className="mb-3 truncate text-xs text-stone-400">{c.chat_id}</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={c.enabled} onChange={(e) => save(c, { enabled: e.target.checked })} />
              Ежедневная сводка
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={c.bot_enabled} onChange={(e) => save(c, { bot_enabled: e.target.checked })} />
              Ответы бота
            </label>
          </div>
        </article>
      ))}
    </div>
  );
}
