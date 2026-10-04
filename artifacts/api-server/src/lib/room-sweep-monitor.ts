import type { RoomSweepResult } from "./room-timers";

export const ROOM_SWEEP_REPORT_INTERVAL_MS = 30_000;
export const ROOM_OVERDUE_WARNING_MS = 15_000;

interface MonitorLogger {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

function emptyWindow() {
  return {
    sweeps: 0, processed: 0, saturatedSweeps: 0, failedRooms: 0,
    failedSweeps: 0, totalDurationMs: 0, maxDurationMs: 0,
  };
}

// One constant-size aggregate and at most one metadata probe in flight. Reports
// run off the reconciliation path, so slow monitoring never delays a new batch.
export class RoomSweepMonitor {
  private window = emptyWindow();
  private nextReportAt = 0;
  private reporting = false;
  private saturationStreak = 0;

  constructor(
    private readonly log: MonitorLogger,
    private readonly readOldestAge: () => Promise<number>,
    private readonly now = () => performance.now(),
  ) {}

  record(result: RoomSweepResult) {
    this.window.sweeps++;
    this.window.processed += result.processed;
    this.window.saturatedSweeps += Number(result.saturated);
    this.window.failedRooms += result.failed;
    this.window.totalDurationMs += result.durationMs;
    this.window.maxDurationMs = Math.max(this.window.maxDurationMs, result.durationMs);
    this.saturationStreak = result.saturated ? this.saturationStreak + 1 : 0;
  }

  recordFailure() {
    this.window.failedSweeps++;
    this.saturationStreak = 0;
  }

  async report(): Promise<void> {
    const now = this.now();
    if (this.reporting || now < this.nextReportAt) return;
    this.reporting = true;
    this.nextReportAt = now + ROOM_SWEEP_REPORT_INTERVAL_MS;
    const window = this.window;
    this.window = emptyWindow();
    const consecutiveSaturatedSweeps = this.saturationStreak;
    try {
      let oldestOverdueAgeMs: number | null = null;
      try {
        oldestOverdueAgeMs = await this.readOldestAge();
      } catch {
        // Unknown is not an empty queue. Never log query errors with parameters
        // or saved state, and never propagate monitoring failures to the sweep.
      }
      const behind = oldestOverdueAgeMs !== null
        && oldestOverdueAgeMs >= ROOM_OVERDUE_WARNING_MS;
      const fields = {
        event: "room_deadline_sweep",
        reportIntervalMs: ROOM_SWEEP_REPORT_INTERVAL_MS,
        ...window,
        totalDurationMs: Math.round(window.totalDurationMs),
        maxDurationMs: Math.round(window.maxDurationMs),
        consecutiveSaturatedSweeps,
        oldestOverdueAgeMs,
        overdueSampleFailed: oldestOverdueAgeMs === null,
        overdueWarningMs: ROOM_OVERDUE_WARNING_MS,
        deadlinesBehind: behind,
      };
      if (behind || window.failedSweeps || window.failedRooms || oldestOverdueAgeMs === null) {
        this.log.warn(fields, "Room deadline sweeper needs attention");
      } else {
        this.log.info(fields, "Room deadline sweep summary");
      }
    } finally {
      this.reporting = false;
    }
  }
}