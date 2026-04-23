import type { ErrorRequestHandler } from "express";
import type pino from "pino";

export function createErrorHandler(logger: pino.Logger): ErrorRequestHandler {
  return (error, _req, res, _next) => {
    logger.error({ err: error }, "Request failed");

    res.status(500).json({
      error: {
        message: "Internal Server Error"
      }
    });
  };
}
