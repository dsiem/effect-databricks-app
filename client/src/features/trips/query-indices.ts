export interface IndexSource {
  readonly length: number;
  matches(this: void, index: number): boolean;
  compare(this: void, left: number, right: number): number;
}

export async function queryIndices(source: IndexSource, signal: AbortSignal) {
  signal.throwIfAborted();
  const channel = new MessageChannel();
  const scheduler: unknown = Reflect.get(globalThis, "scheduler");
  const nativeYield =
    typeof scheduler === "object" &&
    scheduler !== null &&
    "yield" in scheduler &&
    typeof scheduler.yield === "function"
      ? scheduler.yield.bind(scheduler)
      : undefined;
  let turn = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resume: (() => void) | undefined;
  const wake = () => {
    const next = resume;
    resume = undefined;
    next?.();
  };
  channel.port1.onmessage = wake;
  signal.addEventListener("abort", wake);
  const pause = async () => {
    if (nativeYield) await nativeYield();
    else {
      await new Promise<void>((resolve) => {
        resume = resolve;
        // Alternate task sources so timers cannot nest or starve behind port messages.
        if (turn++ % 2 === 0) channel.port2.postMessage(null);
        else timer = setTimeout(wake, 0);
      });
    }
    signal.throwIfAborted();
    deadline = performance.now() + 8;
  };
  let deadline = performance.now() + 8;
  const due = () => performance.now() >= deadline;
  try {
    await pause();
    const selected = new Uint32Array(source.length);
    let count = 0;
    for (let i = 0; i < source.length; i++) {
      if (i % 4096 === 0 && due()) await pause();
      if (source.matches(i)) selected[count++] = i;
    }
    if (count === 0) return new Uint32Array(0);
    let input = selected.subarray(0, count);
    const run = 8192;
    for (let start = 0; start < count; start += run) {
      input.subarray(start, Math.min(start + run, count)).sort(source.compare);
      if (due()) await pause();
    }
    if (count <= run) {
      signal.throwIfAborted();
      return input;
    }
    let output = new Uint32Array(count);
    for (let width = run; width < count; width *= 2) {
      for (let start = 0; start < count; start += width * 2) {
        const middle = Math.min(start + width, count);
        const end = Math.min(middle + width, count);
        let left = start;
        let right = middle;
        let next = start;
        while (left < middle && right < end) {
          const a = input[left];
          const b = input[right];
          if (a === undefined || b === undefined)
            throw new Error("Invalid query index");
          if (source.compare(a, b) <= 0) {
            output[next++] = a;
            left++;
          } else {
            output[next++] = b;
            right++;
          }
          if (next % 4096 === 0 && due()) await pause();
        }
        output.set(input.subarray(left, middle), next);
        next += middle - left;
        output.set(input.subarray(right, end), next);
        if (due()) await pause();
      }
      [input, output] = [output, input];
    }
    signal.throwIfAborted();
    return input;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener("abort", wake);
    channel.port1.close();
    channel.port2.close();
  }
}
