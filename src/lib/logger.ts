import pino from "pino";

const streams = [
  { stream: process.stdout },
  { stream: pino.destination("./pino.log") },
];

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
  },
  pino.multistream(streams)
);

export function setLogLevel(level: string) {
  logger.level = level;
}
