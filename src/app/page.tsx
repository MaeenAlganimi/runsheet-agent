"use client";
import { useState } from "react";
import { ClipboardList, Send, Undo2, RotateCcw, Loader2, CircleCheck, CircleX, TriangleAlert, Clock } from "lucide-react";
import { clock, conflicts, sampleSheet, Sheet, sorted } from "@/lib/runsheet";
import type { Action, ChatTurn } from "@/lib/agent";

const EXAMPLES = ["We're running 10 minutes late", "Add a raffle after the interval for 10 minutes and push the rest back", "Make the welcome speech 15 minutes and ripple", "Give the auction to Lina and cut band set two to 30 minutes"];

export default function Home() {
  const [sheet, setSheet] = useState<Sheet>(sampleSheet);
  const [past, setPast] = useState<Sheet[]>([]);
  const [chat, setChat] = useState<(ChatTurn & { actions?: Action[] })[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mock, setMock] = useState(false);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const issues = conflicts(sheet);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput(""); setBusy(true);
    const history = chat.map(({ role, text }) => ({ role, text }));
    setChat((c) => [...c, { role: "user", text: message }]);
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sheet, history, message }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.actions.some((a: Action) => a.ok)) {
        setPast((p) => [...p, sheet]);
        const before = new Map(sheet.cues.map((c) => [c.id, JSON.stringify(c)]));
        setChanged(new Set((data.sheet as Sheet).cues.filter((c) => before.get(c.id) !== JSON.stringify(c)).map((c) => c.id)));
        setSheet(data.sheet);
      }
      setMock(!!data.mock);
      setChat((c) => [...c, { role: "assistant", text: data.reply, actions: data.actions }]);
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", text: e instanceof Error ? e.message : "Something went wrong." }]);
    } finally { setBusy(false); }
  }

  function undo() { const prev = past.at(-1); if (!prev) return; setSheet(prev); setPast(past.slice(0, -1)); setChanged(new Set()); }

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-5 py-8 text-slate-800 lg:grid-cols-[1.2fr_1fr]">
      <section>
        <header className="mb-5 flex items-center gap-3">
          <ClipboardList className="h-8 w-8 text-indigo-600" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold">Run Sheet Agent</h1>
            <p className="text-sm text-slate-500">Tell it what changed backstage. A Gemini agent edits the show schedule with real tool calls.</p>
          </div>
        </header>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">{sheet.name} <span className="text-slate-400">starts {sheet.startTime}</span></h2>
          <div className="flex gap-2">
            <button onClick={undo} disabled={!past.length} className="inline-flex items-center gap-1 rounded border px-3 py-1 text-sm disabled:opacity-40"><Undo2 className="h-4 w-4" aria-hidden /> Undo</button>
            <button onClick={() => { setSheet(sampleSheet); setPast([]); setChat([]); setChanged(new Set()); }} className="inline-flex items-center gap-1 rounded border px-3 py-1 text-sm"><RotateCcw className="h-4 w-4" aria-hidden /> Reset</button>
          </div>
        </div>
        <ol className="space-y-2">
          {sorted(sheet.cues).map((c) => (
            <li key={c.id} className={`flex items-center gap-4 rounded-xl border bg-white p-3 shadow-sm transition ${changed.has(c.id) ? "border-indigo-400 ring-2 ring-indigo-100" : "border-slate-200"}`}>
              <div className="w-24 shrink-0 font-mono text-sm"><Clock className="mr-1 inline h-3.5 w-3.5 text-slate-400" aria-hidden />{clock(sheet.startTime, c.start)}<div className="text-xs text-slate-400">to {clock(sheet.startTime, c.start + c.duration)}</div></div>
              <div className="flex-1"><div className="font-medium">{c.title}</div><div className="text-xs text-slate-500">{c.duration} min · {c.owner}</div></div>
            </li>
          ))}
        </ol>
        {issues.length > 0 && <ul className="mt-3 space-y-1 text-sm text-amber-700">{issues.map((i) => <li key={i} className="flex gap-2"><TriangleAlert className="h-4 w-4" aria-hidden />{i}</li>)}</ul>}
      </section>

      <section className="flex h-[80vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-8">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {chat.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">Try:</p>
              {EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} className="block w-full rounded-lg bg-slate-50 px-3 py-2 text-left text-sm hover:bg-indigo-50">{e}</button>)}
            </div>
          )}
          {chat.map((t, i) => (
            <div key={i} className={t.role === "user" ? "ml-8 rounded-xl bg-indigo-600 p-3 text-sm text-white" : "mr-8 rounded-xl bg-slate-100 p-3 text-sm"}>
              {t.text}
              {t.actions && t.actions.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-xs">
                  {t.actions.map((a, j) => <li key={j} className="flex gap-1.5">{a.ok ? <CircleCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <CircleX className="h-3.5 w-3.5 text-red-600" aria-hidden />}<code className="text-slate-500">{a.name}</code> {a.summary}</li>)}
                </ul>
              )}
            </div>
          ))}
          {busy && <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Working" />}
        </div>
        {mock && <p className="px-4 text-xs text-amber-700">Demo mode: no Gemini key, a simple rule-based planner is answering.</p>}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t p-3">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. push the band back 5 minutes" maxLength={600} className="flex-1 rounded-lg border px-3 py-2 text-sm" aria-label="Message" />
          <button disabled={busy || !input.trim()} className="rounded-lg bg-indigo-600 px-3 text-white disabled:opacity-40" aria-label="Send"><Send className="h-4 w-4" aria-hidden /></button>
        </form>
      </section>
    </main>
  );
}
