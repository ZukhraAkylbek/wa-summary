import { FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    const auth = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (auth.error) setError(auth.error.message);
    else if (mode === "up" && !auth.data.session) {
      setInfo("Аккаунт создан. Если включено подтверждение почты — открой письмо, затем войди.");
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Сводки WhatsApp</h1>
        <p className="mt-1 mb-5 text-sm text-stone-500">
          {mode === "in" ? "Вход в панель задач и сводок" : "Регистрация"}
        </p>
        <label className="mb-3 block text-sm">
          Почта
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        <label className="mb-4 block text-sm">
          Пароль
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
        {info && <p className="mb-3 text-sm text-stone-600">{info}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-stone-900 py-2 text-white disabled:opacity-50"
        >
          {busy ? "…" : mode === "in" ? "Войти" : "Создать аккаунт"}
        </button>
        <button
          type="button"
          className="mt-3 w-full text-sm text-stone-500 underline"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
        >
          {mode === "in" ? "Нет аккаунта — зарегистрироваться" : "Уже есть аккаунт — войти"}
        </button>
      </form>
    </div>
  );
}
