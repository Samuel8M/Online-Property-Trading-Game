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
  const sweep = () => { void sweepRooms().catch(err => logger.error({ err }, "Room timer sweep failed")); };
  sweep();
  setInterval(sweep, 5000).unref();
});
