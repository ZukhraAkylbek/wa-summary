// On-demand bot commands. Output language: Russian.
import { supabase, type WaMessage } from "../_shared/supabase.ts";
import { TZ } from "../_shared/env.ts";
import { askClaude, askClaudeJson } from "../_shared/claude.ts";
import { getGroupMembers } from "../_shared/waha.ts";
import { log } from "../_shared/log.ts";
import { normalizeTask, type SummaryTask } from "../wa-daily-summary/prompt.ts";
import type { Trigger } from "../_shared/bot.ts";

const ASK_SYSTEM =
  `Ты помощник рабочей группы WhatsApp. Отвечай ТОЛЬКО по переписке ниже.
Если ответа в чате нет — напиши «не знаю». Пиши по-русски, коротко, без markdown.`;

const ON_DEMAND_SYSTEM =
  `Ты помощник команды. Тебе дают переписку группы WhatsApp, список участников и открытые задачи.
Верни ТОЛЬКО JSON без markdown:
{"summary": "итоги 3-7 пунктов через \\n",
 "people": [{"name": "имя", "role": "за что отвечает или null", "open_tasks": ["задача или пусто"]}],
 "tasks": [{"title": "...", "description": "...", "assignee": "имя или null", "due": "YYYY-MM-DD или null", "priority": "low|normal|high|urgent"}]}
Правила:
- Не выдумывай людей, ролей и задач. Только то, что есть в переписке, списке участников или в открытых задачах.
- Если роль не ясна — role: null. Если задач нет — open_tasks: [] и tasks: [].
- Пиши по-русски.`;

const TASK_PARSE_SYSTEM =
  `Разбери поручение из WhatsApp. Верни ТОЛЬКО JSON:
{"title":"...","description":"...","assignee":"имя или null","due":"YYYY-MM-DD или null","priority":"low|normal|high|urgent"}
Не выдумывай исполнителя и срок. По-русски.`;

type PeopleRow = { name?: unknown; role?: unknown; open_tasks?: unknown };
type OnDemandOut = { summary?: string; people?: PeopleRow[]; tasks?: SummaryTask[] };

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function loadTranscript(chatId: string, hours: number, limit = 200): Promise<WaMessage[]> {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("wa_messages")
    .select("id, chat_id, sender, body, ts")
    .eq("chat_id", chatId)
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as WaMessage[]).reverse();
}

async function loadOpenTasks(chatId: string) {
  const { data } = await supabase
    .from("wa_tasks")
    .select("title, assignee, due, priority, status")
    .eq("chat_id", chatId)
    .neq("status", "done")
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

function formatTranscript(list: WaMessage[]): string {
  return list.map((m) => {
    const t = new Date(m.ts).toLocaleTimeString("ru-RU", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit",
    });
    return `[${t}] ${m.sender ?? "?"}: ${m.body ?? ""}`;
  }).join("\n");
}

function formatPeople(people: PeopleRow[]): string {
  const lines = people.map((p) => {
    const name = asStr(p.name);
    if (!name) return null;
    const role = asStr(p.role);
    const tasks = Array.isArray(p.open_tasks)
      ? p.open_tasks.map((x) => asStr(x)).filter((x): x is string => Boolean(x))
      : [];
    let line = `• ${name}${role ? ` — ${role}` : ""}`;
    if (tasks.length) line += `\n  задачи: ${tasks.join("; ")}`;
    return line;
  }).filter((x): x is string => Boolean(x));
  return lines.length ? `Участники и ответственность:\n${lines.join("\n")}` : "";
}

export async function runCommand(
  chatId: string,
  chatName: string | null,
  trigger: Trigger,
): Promise<string> {
  if (trigger.kind === "tasks") {
    const tasks = await loadOpenTasks(chatId);
    if (!tasks.length) return "Открытых задач нет.";
    return "Открытые задачи:\n" + tasks.map((t) => {
      const who = t.assignee ? ` (${t.assignee})` : "";
      const due = t.due ? ` — до ${t.due}` : "";
      return `• [${t.status}] ${t.title}${who}${due}`;
    }).join("\n");
  }

  if (trigger.kind === "task") {
    if (!trigger.arg) return "Напиши так: /task текст поручения";
    const parsed = await askClaudeJson<SummaryTask>({
      system: TASK_PARSE_SYSTEM,
      user: trigger.arg,
      maxTokens: 400,
    });
    const row = normalizeTask(parsed, chatId, "", "bot");
    if (!row) return "Не смогла разобрать задачу. Напиши конкретнее.";
    const { summary_id: _, ...insert } = row;
    const { error } = await supabase.from("wa_tasks").insert({ ...insert, summary_id: null });
    if (error) throw new Error(error.message);
    return `Задача создана: ${insert.title}` +
      (insert.assignee ? ` → ${insert.assignee}` : "") +
      (insert.due ? ` до ${insert.due}` : "");
  }

  const hours = Math.min(Math.max(trigger.hours || 24, 1), 24 * 14);
  const msgs = await loadTranscript(chatId, hours, trigger.kind === "ask" ? 200 : 400);
  const open = await loadOpenTasks(chatId);
  const members = await getGroupMembers(chatId).catch(() => []);

  if (trigger.kind === "ask") {
    if (!msgs.length) return "не знаю — в чате за это время нет сообщений.";
    return await askClaude({
      system: ASK_SYSTEM,
      user: `Вопрос: ${trigger.arg}\n\nПереписка:\n${formatTranscript(msgs)}`,
      maxTokens: 600,
    });
  }

  if (!msgs.length && !open.length) {
    return `В группе «${chatName ?? chatId}» за ${hours} ч нет сообщений и открытых задач.`;
  }

  const context = [
    `Группа: ${chatName ?? chatId}. Окно: ${hours} ч.`,
    members.length
      ? `Участники WhatsApp:\n${members.map((m) => `• ${m.name}${m.admin ? " (админ)" : ""}`).join("\n")}`
      : "",
    open.length
      ? `Открытые задачи из базы:\n${open.map((t) => `• ${t.title}${t.assignee ? ` (${t.assignee})` : ""}`).join("\n")}`
      : "Открытых задач в базе нет.",
    `Переписка:\n${formatTranscript(msgs) || "(пусто)"}`,
  ].filter(Boolean).join("\n\n");

  const out = await askClaudeJson<OnDemandOut>({
    system: ON_DEMAND_SYSTEM,
    user: context,
    maxTokens: 2000,
  });

  const people = formatPeople(out.people ?? []);
  const newTasks = (out.tasks ?? [])
    .map((t) => normalizeTask(t, chatId, "", "bot"))
    .filter((t): t is NonNullable<typeof t> => t !== null);

  if (newTasks.length) {
    const rows = newTasks.map(({ summary_id: _s, ...t }) => ({ ...t, summary_id: null }));
    const { error } = await supabase.from("wa_tasks").insert(rows);
    if (error) log.warn("on-demand tasks insert failed", { error: error.message });
  }

  const taskLines = [...open.map((t) =>
    `• ${t.title}${t.assignee ? ` (${t.assignee})` : ""}${t.due ? ` — до ${t.due}` : ""}`
  ), ...newTasks.map((t) =>
    `• ${t.title}${t.assignee ? ` (${t.assignee})` : ""}`
  )];

  return [
    `Сводка «${chatName ?? "группа"}» за ${hours} ч`,
    people,
    out.summary ? `Итоги:\n${out.summary}` : "",
    taskLines.length ? `Задачи:\n${[...new Set(taskLines)].join("\n")}` : "Открытых задач нет.",
  ].filter(Boolean).join("\n\n");
}
