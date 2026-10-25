export interface Cue {
  id: string;
  title: string;
  /** Minutes after show start. */
  start: number;
  duration: number;
  owner: string;
}

export interface Sheet {
  name: string;
  startTime: string; // "HH:MM"
  cues: Cue[];
}

export const sampleSheet: Sheet = {
  name: "Community hall fundraiser",
  startTime: "18:00",
  cues: [
    { id: "doors", title: "Doors open and welcome drinks", start: 0, duration: 30, owner: "Front of house" },
    { id: "welcome", title: "Welcome speech", start: 30, duration: 10, owner: "Host" },
    { id: "band1", title: "Band set one", start: 40, duration: 35, owner: "Stage manager" },
    { id: "break", title: "Interval", start: 75, duration: 20, owner: "Front of house" },
    { id: "auction", title: "Silent auction results", start: 95, duration: 15, owner: "Host" },
    { id: "band2", title: "Band set two", start: 110, duration: 40, owner: "Stage manager" },
  ],
};

export const sorted = (cues: Cue[]) => [...cues].sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));

export function clock(startTime: string, offset: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const t = (((h * 60 + m + offset) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function toOffset(startTime: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) throw new Error(`Bad time "${hhmm}", use HH:MM`);
  const [sh, sm] = startTime.split(":").map(Number);
  return h * 60 + m - (sh * 60 + sm);
}

export function findCue(sheet: Sheet, ref: string): Cue {
  const q = ref.trim().toLowerCase();
  const exact = sheet.cues.find((c) => c.id === ref || c.title.toLowerCase() === q);
  if (exact) return exact;
  const partial = sheet.cues.filter((c) => c.title.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`"${ref}" matches several cues: ${partial.map((c) => c.title).join(", ")}`);
  throw new Error(`No cue called "${ref}"`);
}

const slug = (s: string, taken: Set<string>) => {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "cue";
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
};

function positive(n: number, what: string) {
  if (!Number.isFinite(n) || n <= 0 || n > 600) throw new Error(`${what} must be between 1 and 600 minutes`);
  return Math.round(n);
}

/** Every operation returns a new sheet plus a one-line summary. They never mutate the input. */
export const ops = {
  add_cue(sheet: Sheet, a: { title: string; at?: string; after?: string; duration: number; owner?: string; push_later?: boolean }) {
    const duration = positive(a.duration, "Duration");
    let start: number;
    if (a.after) { const p = findCue(sheet, a.after); start = p.start + p.duration; }
    else if (a.at) start = toOffset(sheet.startTime, a.at);
    else { const last = sorted(sheet.cues).at(-1); start = last ? last.start + last.duration : 0; }
    const id = slug(a.title, new Set(sheet.cues.map((c) => c.id)));
    let cues = sheet.cues;
    if (a.push_later) cues = cues.map((c) => (c.start >= start ? { ...c, start: c.start + duration } : c));
    const cue: Cue = { id, title: a.title.trim(), start, duration, owner: a.owner?.trim() || "Unassigned" };
    return { sheet: { ...sheet, cues: sorted([...cues, cue]) }, summary: `Added "${cue.title}" at ${clock(sheet.startTime, start)} for ${duration} min${a.push_later ? ", later cues pushed back" : ""}` };
  },
  move_cue(sheet: Sheet, a: { cue: string; to: string }) {
    const c = findCue(sheet, a.cue);
    const start = toOffset(sheet.startTime, a.to);
    return { sheet: { ...sheet, cues: sorted(sheet.cues.map((x) => (x.id === c.id ? { ...x, start } : x))) }, summary: `Moved "${c.title}" to ${clock(sheet.startTime, start)}` };
  },
  shift_from(sheet: Sheet, a: { cue: string; minutes: number }) {
    const c = findCue(sheet, a.cue);
    const m = Math.round(a.minutes);
    if (!m || Math.abs(m) > 600) throw new Error("minutes must be a non-zero number up to 600");
    const cues = sheet.cues.map((x) => (x.start >= c.start ? { ...x, start: x.start + m } : x));
    return { sheet: { ...sheet, cues: sorted(cues) }, summary: `Shifted "${c.title}" and everything after it by ${m > 0 ? "+" : ""}${m} min` };
  },
  set_duration(sheet: Sheet, a: { cue: string; duration: number; ripple?: boolean }) {
    const c = findCue(sheet, a.cue);
    const d = positive(a.duration, "Duration");
    const delta = d - c.duration;
    const cues = sheet.cues.map((x) => (x.id === c.id ? { ...x, duration: d } : a.ripple && x.start > c.start ? { ...x, start: x.start + delta } : x));
    return { sheet: { ...sheet, cues: sorted(cues) }, summary: `"${c.title}" is now ${d} min${a.ripple ? " (later cues rippled)" : ""}` };
  },
  rename_cue(sheet: Sheet, a: { cue: string; title: string }) {
    const c = findCue(sheet, a.cue);
    return { sheet: { ...sheet, cues: sheet.cues.map((x) => (x.id === c.id ? { ...x, title: a.title.trim() } : x)) }, summary: `Renamed "${c.title}" to "${a.title.trim()}"` };
  },
  assign_owner(sheet: Sheet, a: { cue: string; owner: string }) {
    const c = findCue(sheet, a.cue);
    return { sheet: { ...sheet, cues: sheet.cues.map((x) => (x.id === c.id ? { ...x, owner: a.owner.trim() } : x)) }, summary: `"${c.title}" now owned by ${a.owner.trim()}` };
  },
  delete_cue(sheet: Sheet, a: { cue: string; close_gap?: boolean }) {
    const c = findCue(sheet, a.cue);
    let cues = sheet.cues.filter((x) => x.id !== c.id);
    if (a.close_gap) cues = cues.map((x) => (x.start > c.start ? { ...x, start: x.start - c.duration } : x));
    return { sheet: { ...sheet, cues: sorted(cues) }, summary: `Removed "${c.title}"${a.close_gap ? " and closed the gap" : ""}` };
  },
  set_start_time(sheet: Sheet, a: { time: string }) {
    toOffset("00:00", a.time);
    return { sheet: { ...sheet, startTime: a.time }, summary: `Show now starts at ${a.time}` };
  },
};

export type OpName = keyof typeof ops;

export function applyOp(sheet: Sheet, name: string, args: Record<string, unknown>) {
  if (!(name in ops)) throw new Error(`Unknown action ${name}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ops as any)[name](sheet, args) as { sheet: Sheet; summary: string };
}

export function conflicts(sheet: Sheet): string[] {
  const s = sorted(sheet.cues);
  const out: string[] = [];
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1];
    if (s[i].start < prev.start + prev.duration) out.push(`"${s[i].title}" overlaps "${prev.title}" by ${prev.start + prev.duration - s[i].start} min`);
  }
  if (s[0] && s[0].start < 0) out.push(`"${s[0].title}" starts before the show start`);
  return out;
}

export function describe(sheet: Sheet): string {
  return [`Show "${sheet.name}" starts ${sheet.startTime}.`, ...sorted(sheet.cues).map((c) => `- [${c.id}] ${clock(sheet.startTime, c.start)}-${clock(sheet.startTime, c.start + c.duration)} ${c.title} (${c.duration} min, ${c.owner})`)].join("\n");
}

const str = { type: "STRING" }, num = { type: "NUMBER" }, bool = { type: "BOOLEAN" };
const cueRef = { type: "STRING", description: "Cue id or (part of) its title" };
export const toolDeclarations = [
  { name: "add_cue", description: "Add a new cue. Give either `at` (HH:MM) or `after` (an existing cue). With neither it goes at the end.", parameters: { type: "OBJECT", properties: { title: str, at: str, after: cueRef, duration: num, owner: str, push_later: { ...bool, description: "Push every cue at or after the new start back by its duration" } }, required: ["title", "duration"] } },
  { name: "move_cue", description: "Move one cue to a clock time HH:MM without moving others.", parameters: { type: "OBJECT", properties: { cue: cueRef, to: str }, required: ["cue", "to"] } },
  { name: "shift_from", description: "Shift a cue and every cue after it by N minutes (negative = earlier). Use for 'we're running late'.", parameters: { type: "OBJECT", properties: { cue: cueRef, minutes: num }, required: ["cue", "minutes"] } },
  { name: "set_duration", description: "Change a cue's length. ripple=true moves later cues by the difference.", parameters: { type: "OBJECT", properties: { cue: cueRef, duration: num, ripple: bool }, required: ["cue", "duration"] } },
  { name: "rename_cue", description: "Rename a cue.", parameters: { type: "OBJECT", properties: { cue: cueRef, title: str }, required: ["cue", "title"] } },
  { name: "assign_owner", description: "Set who is responsible for a cue.", parameters: { type: "OBJECT", properties: { cue: cueRef, owner: str }, required: ["cue", "owner"] } },
  { name: "delete_cue", description: "Remove a cue. close_gap=true pulls later cues earlier.", parameters: { type: "OBJECT", properties: { cue: cueRef, close_gap: bool }, required: ["cue"] } },
  { name: "set_start_time", description: "Change the show start clock time (HH:MM). Cues keep their offsets.", parameters: { type: "OBJECT", properties: { time: str }, required: ["time"] } },
];
