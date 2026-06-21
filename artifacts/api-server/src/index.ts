// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyEnv } = require("./lib/env");
verifyEnv();

import { createAppServer } from "./app";
import { logger } from "./lib/logger";

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

const server = createAppServer();

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err: Error) => {
  logger.error({ err }, "HTTP server error");
  process.exit(1);
});
