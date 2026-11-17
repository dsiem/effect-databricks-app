import assert from "node:assert/strict";
import { test } from "node:test";
import { queryIndices } from "../src/features/trips/query-indices";

test("index queries return only matching rows in the requested stable order", async () => {
  const values = [8, 2, 8, 3, 2, 9];
  const result = await queryIndices(
    {
      length: values.length,
      matches: (i) => i !== 1,
      compare: (a, b) => (values[a] ?? 0) - (values[b] ?? 0) || a - b,
    },
    new AbortController().signal,
  );
  assert.deepEqual([...result], [4, 3, 0, 2, 5]);
});

test("large queries preserve every matching row and tie order", async () => {
  const result = await queryIndices(
    {
      length: 25000,
      matches: (i) => i % 3 === 0,
      compare: (a, b) => (b % 7) - (a % 7) || a - b,
    },
    new AbortController().signal,
  );
  assert.equal(result.length, 8334);
  const seen = new Set(result);
  assert.equal(seen.size, result.length);
  for (let i = 0; i < result.length; i++) {
    const row = result[i];
    assert.notEqual(row, undefined);
    assert.equal((row ?? 1) % 3, 0);
    if (i) {
      const previous = result[i - 1] ?? 0;
      assert.ok(
        previous % 7 > (row ?? 0) % 7 ||
          (previous % 7 === (row ?? 0) % 7 && previous < (row ?? 0)),
      );
    }
  }
});

test("an input event cancels a sort after work starts and before its result is published", async () => {
  const controller = new AbortController();
  let comparisons = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = queryIndices(
    {
      length: 1000000,
      matches: () => true,
      compare(a, b) {
        if (++comparisons === 10000)
          timer = setTimeout(() => controller.abort(), 0);
        return ((a * 48271) % 2147483647) - ((b * 48271) % 2147483647);
      },
    },
    controller.signal,
  );
  try {
    await assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError",
    );
    assert.ok(comparisons >= 10000);
  } finally {
    if (timer) clearTimeout(timer);
  }
});
