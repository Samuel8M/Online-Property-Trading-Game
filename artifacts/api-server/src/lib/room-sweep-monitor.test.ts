import test from "node:test";
import assert from "node:assert/strict";
import {
  RoomSweepMonitor, ROOM_SWEEP_REPORT_INTERVAL_MS, ROOM_OVERDUE_WARNING_MS,
} from "./room-sweep-monitor";

function fixture(readAge: () => Promise<number>) {
  let now = 0;
  const logs: { level: string; fields: Record<string, unknown>; message: string }[] = [];
  const monitor = new RoomSweepMonitor({
    info: (fields, message) => logs.push({ level: "info", fields: fields as Record<string, unknown>, message }),
    warn: (fields, message) => logs.push({ level: "warn", fields: fields as Record<string, unknown>, message }),
  }, readAge, () => now);
  return { monitor, logs, advance: () => { now += ROOM_SWEEP_REPORT_INTERVAL_MS; } };
}

test("sweep reports aggregate duration, throughput and saturation with bounded cadence", async () => {
  let probes = 0;
  const { monitor, logs, advance } = fixture(async () => { probes++; return 0; });
  monitor.record({ processed: 0, saturated: false, durationMs: 2, failed: 0 });
  await monitor.report();
  assert.equal(logs[0]!.level, "info");
  assert.equal(logs[0]!.fields.oldestOverdueAgeMs, 0);
  for (let i = 0; i < 100; i++) {
    monitor.record({ processed: 100, saturated: true, durationMs: 10, failed: 0 });
    await monitor.report();
  }
  assert.equal(probes, 1, "immediate draining does not produce a probe or log per batch");
  advance();
  await monitor.report();
  assert.equal(logs.length, 2);
  assert.equal(logs[1]!.fields.sweeps, 100);
  assert.equal(logs[1]!.fields.processed, 10_000);
  assert.equal(logs[1]!.fields.saturatedSweeps, 100);
  assert.equal(logs[1]!.fields.consecutiveSaturatedSweeps, 100);
  assert.equal(logs[1]!.fields.totalDurationMs, 1000);
  assert.equal(logs[1]!.fields.maxDurationMs, 10);
});

test("held overdue rows warn despite zero processed and unsaturated sweeps, then recover", async () => {
  let age = ROOM_OVERDUE_WARNING_MS;
  const { monitor, logs, advance } = fixture(async () => age);
  monitor.record({ processed: 0, saturated: false, durationMs: 1, failed: 0 });
  await monitor.report();
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.fields.deadlinesBehind, true);
  age += ROOM_SWEEP_REPORT_INTERVAL_MS;
  advance();
  await monitor.report();
  assert.equal(logs[1]!.fields.oldestOverdueAgeMs, age);
  age = 0;
  advance();
  monitor.record({ processed: 1, saturated: false, durationMs: 1, failed: 0 });
  await monitor.report();
  assert.equal(logs[2]!.level, "info");
  assert.equal(logs[2]!.fields.deadlinesBehind, false);
});

test("sampling errors are unknown, never empty or leaked, and do not stop monitoring", async () => {
  let failing = true;
  const { monitor, logs, advance } = fixture(async () => {
    if (failing) throw new Error("private room state and session token");
    return 0;
  });
  monitor.recordFailure();
  monitor.record({ processed: 1, saturated: false, durationMs: 12, failed: 2 });
  await monitor.report();
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.fields.failedSweeps, 1);
  assert.equal(logs[0]!.fields.failedRooms, 2);
  assert.equal(logs[0]!.fields.oldestOverdueAgeMs, null);
  assert.equal(logs[0]!.fields.overdueSampleFailed, true);
  assert.doesNotMatch(JSON.stringify(logs), /private|session|token/);
  failing = false;
  advance();
  await monitor.report();
  assert.equal(logs[1]!.level, "info");
  assert.equal(logs[1]!.fields.failedSweeps, 0);
  assert.equal(logs[1]!.fields.failedRooms, 0);
});

test("a slow probe never overlaps or blocks sweep recording", async () => {
  let resolve!: (value: number) => void;
  let probes = 0;
  const { monitor, logs, advance } = fixture(() => {
    probes++;
    return new Promise<number>(done => { resolve = done; });
  });
  const pending = monitor.report();
  advance();
  monitor.record({ processed: 100, saturated: true, durationMs: 20, failed: 0 });
  await monitor.report();
  assert.equal(probes, 1);
  resolve(0);
  await pending;
  const next = monitor.report();
  assert.equal(probes, 2);
  resolve(0);
  await next;
  assert.equal(logs[1]!.fields.processed, 100, "work during a probe belongs to the next report");
});