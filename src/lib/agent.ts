import { applyOp, conflicts, describe, Sheet, toolDeclarations } from "./runsheet";

export interface Action { name: string; args: Record<string, unknown>; ok: boolean; summary: string }
export interface ChatTurn { role: "user" | "assistant"; text: string }
export interface AgentResult { sheet: Sheet; reply: string; actions: Action[] }

type GeminiPart = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: unknown };
type Content = { role: "user" | "model"; parts: GeminiPart[] };
export type Fetcher = (body: object) => Promise<{ parts: GeminiPart[] }>;

const SYSTEM = `You are a stage manager's assistant that edits a live event run sheet by calling tools.
Rules:
- Make the change with tools; do not just describe it. Several tool calls are fine.
- Times are 24h HH:MM clock times. Durations are minutes.
- If a request is ambiguous (e.g. two cues match), ask one short question instead of guessing.
- After acting, reply in one or two plain sentences saying what changed and flag any overlaps you could not fix.
- Refuse anything unrelated to the run sheet politely.`;

export const MAX_STEPS = 6;

export async function runAgent(sheet: Sheet, history: ChatTurn[], message: string, call: Fetcher): Promise<AgentResult> {
  const actions: Action[] = [];
  const contents: Content[] = [
    ...history.slice(-8).map((t) => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text }] }) as Content),
    { role: "user", parts: [{ text: `Current run sheet:\n${describe(sheet)}\n\nRequest: ${message}` }] },
  ];
  for (let step = 0; step < MAX_STEPS; step++) {
    const { parts } = await call({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: [{ functionDeclarations: toolDeclarations }], generationConfig: { temperature: 0.2 } });
    const calls = parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      const text = parts.map((p) => p.text ?? "").join("").trim();
      const issues = conflicts(sheet);
      return { sheet, actions, reply: (text || "Done.") + (issues.length && !/overlap/i.test(text) ? ` Heads up: ${issues.join("; ")}.` : "") };
    }
    contents.push({ role: "model", parts });
    const responses: GeminiPart[] = [];
    for (const p of calls) {
      const { name, args = {} } = p.functionCall!;
      try {
        const r = applyOp(sheet, name, args);
        sheet = r.sheet;
        actions.push({ name, args, ok: true, summary: r.summary });
        responses.push({ functionResponse: { name, response: { ok: true, summary: r.summary, sheet: describe(sheet), conflicts: conflicts(sheet) } } });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        actions.push({ name, args, ok: false, summary: error });
        responses.push({ functionResponse: { name, response: { ok: false, error } } });
      }
    }
    contents.push({ role: "user", parts: responses });
  }
  return { sheet, actions, reply: "I made the changes I could but stopped after several steps. Check the sheet." };
}

export function geminiFetcher(key: string, models: string[]): Fetcher {
  return async (body) => {
    let last = "";
    for (const model of models) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        return { parts: data?.candidates?.[0]?.content?.parts ?? [] };
      }
      last = `${model}: ${res.status}`;
      if (![404, 429, 503].includes(res.status)) break;
    }
    throw new Error(last);
  };
}

/** Offline planner for demo mode: understands a few phrasings so the UI still works without a key. */
export function mockFetcher(message: string): Fetcher {
  let done = false;
  return async () => {
    if (done) return { parts: [{ text: "Done (demo mode, rule-based, no Gemini key)." }] };
    done = true;
    const m = message.toLowerCase();
    let late = m.match(/(?:running|run)\s+(\d+)\s*min(?:utes)?\s+late/);
    if (late) return { parts: [{ functionCall: { name: "shift_from", args: { cue: "welcome", minutes: Number(late[1]) } } }] };
    late = m.match(/add (?:a |an )?(.+?) after (.+?)(?: for (\d+)\s*min)?$/);
    if (late) return { parts: [{ functionCall: { name: "add_cue", args: { title: late[1], after: late[2], duration: Number(late[3] ?? 10), push_later: true } } }] };
    const del = m.match(/(?:remove|delete|cut) (?:the )?(.+)$/);
    if (del) return { parts: [{ functionCall: { name: "delete_cue", args: { cue: del[1], close_gap: true } } }] };
    return { parts: [{ text: "Demo mode understands: 'we're running 10 minutes late', 'add a raffle after interval for 10 min', 'remove the auction'." }] };
  };
}
