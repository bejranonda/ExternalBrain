import { describe, expect, it, vi } from "vitest";
import { debounce } from "./solution.js";

describe("debounce", () => {
  it("only invokes fn once after the wait period following the last call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced("a");
    vi.advanceTimersByTime(50);
    debounced("b");
    vi.advanceTimersByTime(50);
    debounced("c");
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
    vi.useRealTimers();
  });

  it("exposes a cancel() method that clears the pending invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100) as ((...a: unknown[]) => void) & {
      cancel?: () => void;
    };

    debounced("x");
    expect(typeof debounced.cancel).toBe("function");
    debounced.cancel?.();
    vi.advanceTimersByTime(200);

    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
