import { type Table, tableFromArrays, tableToIPC } from "apache-arrow";

// Exercise the real SQL adapter without a workspace or signed storage endpoint.
export const warehouseFetch = (
  beforeStatement: (
    sql: string,
    signal: AbortSignal,
  ) => Promise<void> | Promise<Table> = async () => {},
): typeof globalThis.fetch => {
  const chunks = new Map<string, Uint8Array>();
  let sequence = 0;
  return async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith("https://results.invalid/")) {
      const bytes = chunks.get(request.url);
      if (!bytes) throw new Error("Unknown result chunk");
      return new Response(new Uint8Array(bytes));
    }
    if (request.method !== "POST" || !request.url.endsWith("/sql/statements"))
      throw new Error(
        `Unexpected warehouse request: ${request.method} ${request.url}`,
      );
    const { statement } = (await request.json()) as { statement: string };
    const result = await beforeStatement(statement, request.signal);
    const id = String(++sequence);
    const url = `https://results.invalid/${id}`;
    const table =
      result ??
      (/MIN\(tpep_pickup_datetime\)/.test(statement)
        ? tableFromArrays({
            from: ["2016-01-01"],
            to: ["2016-12-31"],
            trips: [10],
          })
        : tableFromArrays({}));
    chunks.set(url, tableToIPC(table));
    return Response.json({
      statement_id: id,
      status: { state: "SUCCEEDED" },
      manifest: {
        format: "ARROW_STREAM",
        total_chunk_count: 1,
        truncated: false,
      },
      result: { external_links: [{ chunk_index: 0, external_link: url }] },
    });
  };
};
