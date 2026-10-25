import app from "./app";
import { logger } from "./lib/logger";
import { startSnapshotLoop } from "./lib/snapshots";

if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) throw new Error("Set AUTH_SECRET to at least 32 random characters");

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
  startSnapshotLoop();
});
