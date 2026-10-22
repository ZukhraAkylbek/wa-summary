import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { Login } from "./pages/Login";
import { TasksPage } from "./pages/Tasks";
import { SummariesPage } from "./pages/Summaries";
import { GroupsPage } from "./pages/Groups";

const TABS = [
  ["tasks", "Задачи"],
  ["summaries", "Сводки"],
  ["groups", "Группы"],
] as const;

type Tab = (typeof TABS)[number][0];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("tasks");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <p className="p-8 text-stone-500">Загрузка…</p>;
  if (!session) return <Login />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-[#f4f1ea]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <strong className="mr-auto text-lg">Сводки WhatsApp</strong>
          <nav className="flex gap-1">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`rounded-full px-3 py-1.5 text-sm ${tab === id ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-200"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            className="text-sm text-stone-500 underline"
            onClick={() => supabase.auth.signOut()}
          >
            Выйти
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "tasks" && <TasksPage />}
        {tab === "summaries" && <SummariesPage onOpenTasks={() => setTab("tasks")} />}
        {tab === "groups" && <GroupsPage />}
      </main>
    </div>
  );
}
