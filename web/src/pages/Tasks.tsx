import { useEffect, useMemo, useState } from "react";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  supabase,
  type Chat,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../lib/supabase";

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "done"];
const NEXT: Record<TaskStatus, TaskStatus> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [group, setGroup] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [t, c] = await Promise.all([
      supabase.from("wa_tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("wa_chats").select("chat_id,name,enabled,bot_enabled,last_seen"),
    ]);
    if (t.error) setError(t.error.message);
    else setTasks((t.data ?? []) as Task[]);
    if (!c.error) setChats((c.data ?? []) as Chat[]);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("wa_tasks_ui")
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_tasks" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const names = useMemo(
    () => new Map(chats.map((c) => [c.chat_id, c.name || c.chat_id])),
    [chats],
  );
  const people = useMemo(
    () => [...new Set(tasks.map((t) => t.assignee).filter(Boolean))] as string[],
    [tasks],
  );

  const shown = tasks.filter((t) => {
    if (group && t.chat_id !== group) return false;
    if (assignee && t.assignee !== assignee) return false;
    if (due && t.due !== due) return false;
    if (q && !`${t.title} ${t.description ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  async function patch(id: string, row: Partial<Task>) {
    const { error: e } = await supabase.from("wa_tasks").update(row).eq("id", id);
    if (e) setError(e.message);
  }

  return (
    <div>
      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <input
          placeholder="Поиск"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        />
        <select value={group} onChange={(e) => setGroup(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
          <option value="">Все группы</option>
          {chats.map((c) => <option key={c.chat_id} value={c.chat_id}>{c.name || c.chat_id}</option>)}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
          <option value="">Все исполнители</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
      </div>
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        {COLUMNS.map((status) => (
          <section key={status} className="rounded-2xl bg-white/70 p-3">
            <h2 className="mb-2 text-sm font-semibold text-stone-500">
              {STATUS_LABEL[status]} · {shown.filter((t) => t.status === status).length}
            </h2>
            <div className="flex flex-col gap-2">
              {shown.filter((t) => t.status === status).map((t) => (
                <article key={t.id} className="rounded-xl border border-stone-200 bg-white p-3">
                  <input
                    value={t.title}
                    onChange={(e) => setTasks((all) => all.map((x) => x.id === t.id ? { ...x, title: e.target.value } : x))}
                    onBlur={(e) => patch(t.id, { title: e.target.value })}
                    className="w-full font-medium outline-none"
                  />
                  <p className="mt-1 text-xs text-stone-500">{names.get(t.chat_id) || t.chat_id}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <input
                      placeholder="Исполнитель"
                      value={t.assignee ?? ""}
                      onChange={(e) => setTasks((all) => all.map((x) => x.id === t.id ? { ...x, assignee: e.target.value } : x))}
                      onBlur={(e) => patch(t.id, { assignee: e.target.value || null })}
                      className="rounded border border-stone-200 px-2 py-1"
                    />
                    <input
                      type="date"
                      value={t.due ?? ""}
                      onChange={(e) => {
                        setTasks((all) => all.map((x) => x.id === t.id ? { ...x, due: e.target.value } : x));
                        patch(t.id, { due: e.target.value || null });
                      }}
                      className="rounded border border-stone-200 px-2 py-1"
                    />
                    <select
                      value={t.priority}
                      onChange={(e) => {
                        const priority = e.target.value as TaskPriority;
                        setTasks((all) => all.map((x) => x.id === t.id ? { ...x, priority } : x));
                        patch(t.id, { priority });
                      }}
                      className="rounded border border-stone-200 px-2 py-1"
                    >
                      {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                        <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                      ))}
                    </select>
                    <button
                      className="rounded bg-stone-900 px-2 py-1 text-white"
                      onClick={() => patch(t.id, { status: NEXT[t.status] })}
                    >
                      {STATUS_LABEL[NEXT[t.status]]}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
