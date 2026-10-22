import { useEffect, useState } from "react";
import { supabase, type Chat, type Summary, type Task } from "../lib/supabase";

export function SummariesPage({ onOpenTasks }: { onOpenTasks: () => void }) {
  const [rows, setRows] = useState<Summary[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("wa_summaries").select("*").order("day", { ascending: false }),
      supabase.from("wa_chats").select("chat_id,name,enabled,bot_enabled,last_seen"),
      supabase.from("wa_tasks").select("id,summary_id,title,chat_id,status"),
    ]).then(([s, c, t]) => {
      if (s.error) setError(s.error.message);
      setRows((s.data ?? []) as Summary[]);
      setChats((c.data ?? []) as Chat[]);
      setTasks((t.data ?? []) as Task[]);
    });
  }, []);

  const names = new Map(chats.map((c) => [c.chat_id, c.name || c.chat_id]));

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!rows.length && <p className="text-stone-500">Сводок пока нет. Напиши в группу «сводка» или /summary.</p>}
      {rows.map((s) => {
        const linked = tasks.filter((t) => t.summary_id === s.id);
        return (
          <article key={s.id} className="rounded-2xl bg-white p-4">
            <button className="w-full text-left" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong>{names.get(s.chat_id) || s.chat_id}</strong>
                <span className="text-sm text-stone-500">{s.day} · сообщений {s.messages_count ?? "—"}</span>
              </div>
            </button>
            {open === s.id && (
              <div className="mt-3 whitespace-pre-wrap text-sm leading-6">{s.summary}</div>
            )}
            {linked.length > 0 && (
              <button className="mt-3 text-sm text-stone-600 underline" onClick={onOpenTasks}>
                Задачи сводки: {linked.map((t) => t.title).join(", ")}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
