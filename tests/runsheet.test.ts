import { describe as d, expect, it } from "vitest";
import { applyOp, clock, conflicts, findCue, ops, sampleSheet, toOffset } from "../src/lib/runsheet";
import { runAgent, mockFetcher, Fetcher } from "../src/lib/agent";

const s = sampleSheet;

d("run sheet operations", () => {
  it("formats clock times", () => { expect(clock("18:00", 95)).toBe("19:35"); expect(clock("23:30", 45)).toBe("00:15"); });
  it("parses offsets", () => { expect(toOffset("18:00", "19:15")).toBe(75); expect(() => toOffset("18:00", "25:00")).toThrow(); });
  it("finds cues by partial title and rejects ambiguity", () => {
    expect(findCue(s, "auction").id).toBe("auction");
    expect(() => findCue(s, "band")).toThrow(/several/);
  });
  it("adds after a cue and pushes later cues", () => {
    const r = ops.add_cue(s, { title: "Raffle", after: "interval", duration: 10, push_later: true });
    expect(r.sheet.cues.find((c) => c.title === "Raffle")!.start).toBe(95);
    expect(r.sheet.cues.find((c) => c.id === "auction")!.start).toBe(105);
    expect(conflicts(r.sheet)).toEqual([]);
  });
  it("shifts a cue and everything after", () => {
    const r = ops.shift_from(s, { cue: "welcome", minutes: 15 });
    expect(r.sheet.cues.find((c) => c.id === "doors")!.start).toBe(0);
    expect(r.sheet.cues.find((c) => c.id === "band2")!.start).toBe(125);
  });
  it("ripples duration changes", () => {
    const r = ops.set_duration(s, { cue: "welcome", duration: 20, ripple: true });
    expect(r.sheet.cues.find((c) => c.id === "band1")!.start).toBe(50);
  });
  it("deletes and closes the gap", () => {
    const r = ops.delete_cue(s, { cue: "auction", close_gap: true });
    expect(r.sheet.cues.find((c) => c.id === "band2")!.start).toBe(95);
  });
  it("detects overlaps", () => expect(conflicts(ops.move_cue(s, { cue: "auction", to: "19:00" }).sheet)[0]).toMatch(/overlaps/));
  it("never mutates input", () => { ops.shift_from(s, { cue: "doors", minutes: 5 }); expect(s.cues[0].start).toBe(0); });
  it("rejects unknown actions and bad durations", () => {
    expect(() => applyOp(s, "drop_table", {})).toThrow();
    expect(() => ops.set_duration(s, { cue: "welcome", duration: -5 })).toThrow();
  });
});

d("agent loop", () => {
  it("executes tool calls, feeds results back, and returns the final reply", async () => {
    const seen: object[] = [];
    let n = 0;
    const fake: Fetcher = async (body) => {
      seen.push(body);
      n++;
      if (n === 1) return { parts: [{ functionCall: { name: "shift_from", args: { cue: "welcome", minutes: 10 } } }, { functionCall: { name: "assign_owner", args: { cue: "auction", owner: "Lina" } } }] };
      return { parts: [{ text: "Pushed everything from the welcome speech by 10 minutes and gave the auction to Lina." }] };
    };
    const r = await runAgent(s, [], "running 10 late, Lina does auction", fake);
    expect(r.actions.map((a) => a.ok)).toEqual([true, true]);
    expect(r.sheet.cues.find((c) => c.id === "auction")!.owner).toBe("Lina");
    expect(r.sheet.cues.find((c) => c.id === "welcome")!.start).toBe(40);
    expect(JSON.stringify(seen[1])).toContain("functionResponse");
  });
  it("reports tool errors back to the model instead of crashing", async () => {
    let n = 0;
    const fake: Fetcher = async () => (++n === 1 ? { parts: [{ functionCall: { name: "delete_cue", args: { cue: "fireworks" } } }] } : { parts: [{ text: "There is no fireworks cue." }] });
    const r = await runAgent(s, [], "cut fireworks", fake);
    expect(r.actions[0].ok).toBe(false);
    expect(r.sheet).toBe(s);
  });
  it("stops after the step limit", async () => {
    const loop: Fetcher = async () => ({ parts: [{ functionCall: { name: "rename_cue", args: { cue: "doors", title: "Doors" } } }] });
    const r = await runAgent(s, [], "loop", loop);
    expect(r.actions.length).toBe(6);
  });
  it("demo planner handles 'running late'", async () => {
    const r = await runAgent(s, [], "we're running 5 minutes late", mockFetcher("we're running 5 minutes late"));
    expect(r.sheet.cues.find((c) => c.id === "band2")!.start).toBe(115);
  });
});
