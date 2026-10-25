# Run Sheet Agent

An AI stage manager for live events. Type what just changed backstage ("we're running 10 minutes late", "add a raffle after the interval and push the rest back", "Lina is doing the auction now") and a Gemini agent edits the show's run sheet with real tool calls. Times ripple, overlaps are flagged, and every change is listed and can be undone.

**Live demo:** https://runsheet-agent.onrender.com (free instance, first load can take ~50 s to wake)

## Why it's an agent, not a chatbot

The model never writes the schedule as text. It can only act through eight typed tools:

| Tool | What it does |
| --- | --- |
| `add_cue` | Insert at a time, after a cue, or at the end, optionally pushing later cues back |
| `move_cue` | Move one cue to a clock time |
| `shift_from` | Shift a cue and everything after it ("running late") |
| `set_duration` | Change a length, optionally rippling later cues |
| `rename_cue`, `assign_owner` | Edit details |
| `delete_cue` | Remove, optionally closing the gap |
| `set_start_time` | Move the whole show |

The server runs a loop (max 6 steps): Gemini proposes function calls, the app validates and applies them with pure functions, and the results go back to the model (new sheet plus any overlaps), so it can correct itself or ask a question when a cue name is ambiguous. Bad calls such as unknown cues or negative durations come back as errors instead of crashing.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · Gemini API function calling (REST) · Vitest · lucide icons

## Run locally

```bash
npm install
cp env.example .env.local   # free key: https://aistudio.google.com/apikey
npm run dev
npm test                    # operations + agent loop with a fake model
```

Without `GEMINI_API_KEY` the app runs in a labelled demo mode with a small rule-based planner.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Gemini key |
| `GEMINI_MODEL` | Optional, default `gemini-3.5-flash` |
| `GEMINI_FALLBACK_MODEL` | Optional, used on 429/503, default `gemini-flash-latest` |

## Layout

- `src/lib/runsheet.ts`: data model, the eight operations (immutable), overlap detection, tool declarations
- `src/lib/agent.ts`: the tool-calling loop, Gemini client with fallback, offline demo planner
- `src/app/api/agent/route.ts`: validation and limits
- `src/app/page.tsx`: timeline, chat, action log, undo
