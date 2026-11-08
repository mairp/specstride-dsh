/**
 * T037 — PT-121-016 (F121-FR-016, F121-SC-003): the loopback gate. The server
 * half only wires itself into the dsh web server when the host is 127.0.0.1.
 * With any other host (0.0.0.0 here, plus more non-loopback values) there is no
 * `register` call, no `tapIndex` call, and exactly one log line
 * `specstride-kanban: route not registered: web server host is <host>, not
 * 127.0.0.1`. With 127.0.0.1 both registrations happen: the view route is
 * registered and the index is tapped.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { start, type StartResult } from "../../src/server/index.ts";

/** A webServer stub that records both ways the server half can wire itself in. */
function stubWebServer(host: string | undefined) {
  const registered: unknown[] = [];
  const tapped: unknown[] = [];
  return {
    host,
    register: (route: Record<string, unknown>) => {
      registered.push(route);
      return () => undefined;
    },
    tapIndex: (tap: (html: string) => string) => {
      tapped.push(tap);
      return () => undefined;
    },
    calls: { get registered() { return registered; }, get tapped() { return tapped; } },
  };
}

/**
 * Collect the log lines the gate emits while `run` executes. Both channels are
 * captured so the assertion is about the line, not about which console method
 * carries it; exactly one line must come out of one refused start.
 */
function captureLogs(run: () => StartResult): string[] {
  const lines: string[] = [];
  const drain = (...parts: unknown[]) => { lines.push(parts.join(" ")); };
  const originalError = console.error;
  const originalLog = console.log;
  console.error = drain;
  console.log = drain;
  try {
    run();
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  return lines;
}

test("host 0.0.0.0: nothing registers and exactly one refusal line is logged", () => {
  const webServer = stubWebServer("0.0.0.0");
  const lines = captureLogs(() => start({ webServer }));
  assert.equal(lines.length, 1, `expected exactly one log line, got ${JSON.stringify(lines)}`);
  assert.equal(
    lines[0],
    "specstride-kanban: route not registered: web server host is 0.0.0.0, not 127.0.0.1",
  );
  assert.deepEqual(webServer.calls.registered, [], "no route may be registered on a non-loopback host");
  assert.deepEqual(webServer.calls.tapped, [], "no index tap may be installed on a non-loopback host");
});

for (const host of ["localhost", "::", "10.0.0.7", "0.0.0.0", "127.0.0.2", ""]) {
  test(`any host but 127.0.0.1 refuses: ${JSON.stringify(host)}`, () => {
    const webServer = stubWebServer(host);
    const lines = captureLogs(() => start({ webServer }));
    assert.deepEqual(webServer.calls.registered, []);
    assert.deepEqual(webServer.calls.tapped, []);
    assert.deepEqual(lines, [
      `specstride-kanban: route not registered: web server host is ${host}, not 127.0.0.1`,
    ]);
  });
}

test("host 127.0.0.1: both registrations happen (route and index tap)", () => {
  const webServer = stubWebServer("127.0.0.1");
  const lines = captureLogs(() => start({ webServer }));
  assert.deepEqual(lines, [], "the accepted host must not log a refusal");
  assert.equal(webServer.calls.registered.length, 1, "the view route must be registered exactly once");
  assert.equal(webServer.calls.tapped.length, 1, "the index must be tapped exactly once");
});
