import { NextResponse } from "next/server";
import { ChatTurn, geminiFetcher, mockFetcher, runAgent } from "@/lib/agent";
import { Sheet } from "@/lib/runsheet";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { sheet?: Sheet; history?: ChatTurn[]; message?: string } | null;
  const message = body?.message?.trim();
  if (!body?.sheet || !Array.isArray(body.sheet.cues) || !message) return NextResponse.json({ error: "Send a sheet and a message." }, { status: 400 });
  if (message.length > 600 || body.sheet.cues.length > 80) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  const key = process.env.GEMINI_API_KEY;
  const mock = !key || process.env.RUNSHEET_MOCK === "1";
  const models = [process.env.GEMINI_MODEL || "gemini-3.5-flash", process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-latest"];
  try {
    const result = await runAgent(body.sheet, body.history ?? [], message, mock ? mockFetcher(message) : geminiFetcher(key!, models));
    return NextResponse.json({ ...result, mock });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("agent failed:", msg);
    const busy = /429|503/.test(msg);
    return NextResponse.json({ error: busy ? "The AI is busy or the free daily limit was reached. Try again later." : "The agent hit an error." }, { status: busy ? 503 : 502 });
  }
}
