import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export const listen = async (
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
) => {
  const errors: unknown[] = [];
  const server = createServer((req, res) => {
    void handler(req, res).catch((error: unknown) => {
      errors.push(error);
      res.writeHead(500).end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
      assert.deepEqual(errors, []);
    },
  };
};
