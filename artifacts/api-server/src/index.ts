import app from "./app";
import { logger } from "./lib/logger";
import { sweepRooms } from "./routes/games";
import { oldestRoomOverdueAge } from "./lib/room-timers";
import { RoomSweepMonitor } from "./lib/room-sweep-monitor";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  const monitor = new RoomSweepMonitor(logger, oldestRoomOverdueAge);
  const sweep = async () => {
    let saturated = false;
    try {
      const result = await sweepRooms();
      if (result) {
        saturated = result.saturated;
        monitor.record(result);
      }
    } catch (err) {
      monitor.recordFailure();
      logger.error({ err }, "Room timer sweep failed");
    }
    // Deliberately detached: the metadata probe/logging must not hold up work.
    void monitor.report().catch(() => {
      logger.warn({ event: "room_deadline_monitor_failed" }, "Room deadline monitoring failed");
    });
    // Drain backlogs promptly, yielding between bounded batches. Normal idle
    // polling remains every five seconds, with no overlapping sweep callbacks.
    setTimeout(() => { void sweep(); }, saturated ? 0 : 5000).unref();
  };
  void sweep();
});
