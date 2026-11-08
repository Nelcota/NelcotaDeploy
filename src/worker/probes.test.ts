import { expect, spyOn, test } from "bun:test";

import { networkProbes } from "./probes";

test("closes a TCP socket that becomes available after the probe deadline", async () => {
  const closed = Promise.withResolvers<void>();
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {}, close: () => closed.resolve() },
  });
  using _server = { [Symbol.dispose]: () => server.stop(true) };
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: { data() {} },
  });
  using _socket = { [Symbol.dispose]: () => socket.end() };
  const opening = Promise.withResolvers<typeof socket>();
  const connect = spyOn(Bun, "connect").mockImplementation(() => opening.promise);
  using _connect = { [Symbol.dispose]: () => connect.mockRestore() };

  expect(await networkProbes.tcp("127.0.0.1", server.port)).toBe(false);
  opening.resolve(socket);
  const closeTimeoutInMs = 500;
  await Promise.race([
    closed.promise,
    Bun.sleep(closeTimeoutInMs).then(() => {
      throw new Error("Late TCP socket was not closed");
    }),
  ]);
});

test("a successful TCP probe closes its socket", async () => {
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  using _server = { [Symbol.dispose]: () => server.stop(true) };
  expect(await networkProbes.tcp("127.0.0.1", server.port)).toBe(true);
});
