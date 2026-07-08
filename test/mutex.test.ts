import { describe, it, expect } from "vitest";
import { withLock } from "../src/utils/mutex";

describe("withLock", () => {
  it("runs calls for the same key one at a time, in call order", async () => {
    const order: number[] = [];
    const slow = async (n: number, delay: number) => {
      await new Promise((r) => setTimeout(r, delay));
      order.push(n);
    };

    // Call 2 would finish before call 1 if they ran concurrently (10ms vs
    // 30ms) — withLock must force call 1 to complete first regardless.
    const p1 = withLock("thread-a", () => slow(1, 30));
    const p2 = withLock("thread-a", () => slow(2, 10));
    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2]);
  });

  it("does not serialize calls under different keys", async () => {
    const order: string[] = [];
    const slow = async (label: string, delay: number) => {
      await new Promise((r) => setTimeout(r, delay));
      order.push(label);
    };

    const p1 = withLock("thread-a", () => slow("a", 30));
    const p2 = withLock("thread-b", () => slow("b", 10));
    await Promise.all([p1, p2]);

    // Different keys run independently, so the faster one finishes first.
    expect(order).toEqual(["b", "a"]);
  });

  it("still runs the next queued call after an earlier one throws", async () => {
    const order: string[] = [];

    const p1 = withLock("thread-a", async () => {
      order.push("first");
      throw new Error("boom");
    }).catch(() => undefined);

    const p2 = withLock("thread-a", async () => {
      order.push("second");
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual(["first", "second"]);
  });

  it("propagates the return value and rejection of the wrapped call", async () => {
    await expect(withLock("k", async () => 42)).resolves.toBe(42);
    await expect(withLock("k", async () => {
      throw new Error("nope");
    })).rejects.toThrow("nope");
  });
});
