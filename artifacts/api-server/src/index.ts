import app from "./app";
import { logger } from "./lib/logger";
import { sweepRooms } from "./routes/games";

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
  const sweep = async () => {
    let saturated = false;
    try { saturated = await sweepRooms(); }
    catch (err) { logger.error({ err }, "Room timer sweep failed"); }
    // Drain backlogs promptly, yielding between bounded batches. Normal idle
    // polling remains every five seconds, with no overlapping sweep callbacks.
    setTimeout(() => { void sweep(); }, saturated ? 0 : 5000).unref();
  };
  void sweep();
});
