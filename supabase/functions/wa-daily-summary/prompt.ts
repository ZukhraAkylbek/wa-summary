// Prompt and output validation for the daily summary. Output language: Russian.
import type { TaskPriority, WaTaskInsert } from "../_shared/supabase.ts";

export const SUMMARY_SYSTEM =
  `Ты помощник команды. Тебе дают переписку рабочей группы WhatsApp за день.
Верни ТОЛЬКО JSON без markdown и пояснений, строго в формате:
{"summary": "краткое саммари на русском, 3-7 пунктов, разделённых \\n",
 "tasks": [{"title": "...", "description": "...", "assignee": "имя или null", "due": "YYYY-MM-DD или null", "priority": "low|normal|high|urgent"}]}
Правила:
- Не выдумывай задач. Бери только то, что явно поручено, решено или о чём договорились в чате.
- Исполнителя указывай только если он назван в переписке. Срок указывай только если он назван.
- Если задач нет, верни "tasks": [].
- Пиши по-русски.`;

export type SummaryTask = {
  title?: unknown;
  description?: unknown;
  assignee?: unknown;
  due?: unknown;
  priority?: unknown;
};

export type SummaryOutput = {
  summary: string;
  tasks?: SummaryTask[];
};

const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// Accept only real ISO dates; anything else becomes null rather than failing the insert
const isoDate = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;

export function normalizeTask(
  t: SummaryTask,
  chatId: string,
  summaryId: string,
  source: "summary" | "bot" = "summary",
): WaTaskInsert | null {
  const title = str(t.title);
  if (!title) return null;
  const priority = PRIORITIES.includes(t.priority as TaskPriority)
    ? (t.priority as TaskPriority)
    : "normal";
  return {
    summary_id: summaryId,
    chat_id: chatId,
    title: title.slice(0, 300),
    description: str(t.description),
    assignee: str(t.assignee),
    due: isoDate(t.due),
    priority,
    source,
  };
}
