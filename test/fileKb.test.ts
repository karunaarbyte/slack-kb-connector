import { describe, it, expect, beforeEach, vi } from "vitest";

// fileKb.ts writes to a hardcoded path (kb-summaries.md at the repo root) —
// mock fs so these tests exercise the marker/parsing logic without touching
// the real file.
let virtualFile: string | null = null;

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => virtualFile !== null),
    readFileSync: vi.fn(() => virtualFile ?? ""),
    writeFileSync: vi.fn((_path: string, content: string) => {
      virtualFile = content;
    }),
    appendFileSync: vi.fn((_path: string, content: string) => {
      virtualFile = (virtualFile ?? "") + content;
    }),
  },
}));

const fileKb = await import("../src/services/fileKb");

describe("fileKb", () => {
  beforeEach(() => {
    virtualFile = null;
  });

  it("findEntry returns null when the file doesn't exist yet", () => {
    expect(fileKb.findEntry("C1", "1.1")).toBeNull();
  });

  it("saveSummary then findEntry round-trips the body and last_ts", () => {
    fileKb.saveSummary("C1", "1.1", "My Title", "The body content.", "1.5");
    const entry = fileKb.findEntry("C1", "1.1");

    expect(entry).not.toBeNull();
    expect(entry!.lastMessageTs).toBe("1.5");
    expect(entry!.previousBody).toContain("The body content.");
  });

  it("findEntry doesn't match a different thread_ts on the same channel", () => {
    fileKb.saveSummary("C1", "1.1", "Title", "Body", "1.5");
    expect(fileKb.findEntry("C1", "9.9")).toBeNull();
  });

  it("appendUpdate advances last_ts and adds an Update section without losing the original body", () => {
    fileKb.saveSummary("C1", "1.1", "Title", "Original body.", "1.5");
    fileKb.appendUpdate("C1", "1.1", "New info.", "2.5");

    const entry = fileKb.findEntry("C1", "1.1");
    expect(entry!.lastMessageTs).toBe("2.5");
    expect(entry!.previousBody).toContain("Original body.");
    expect(entry!.previousBody).toContain("New info.");
  });

  it("appendUpdate throws if there's no existing entry for the thread", () => {
    expect(() => fileKb.appendUpdate("C1", "1.1", "New info.", "2.5")).toThrow();
  });

  it("does not confuse two different threads' entries in the same file", () => {
    fileKb.saveSummary("C1", "1.1", "First", "First body.", "1.0");
    fileKb.saveSummary("C1", "2.2", "Second", "Second body.", "2.0");

    expect(fileKb.findEntry("C1", "1.1")!.previousBody).toContain("First body.");
    expect(fileKb.findEntry("C1", "2.2")!.previousBody).toContain("Second body.");
  });
});
