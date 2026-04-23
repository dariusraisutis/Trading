import type { NextFunction, Request, Response } from "express";
import type pino from "pino";

export function createRequestLogger(logger: pino.Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();

    res.on("finish", () => {
      logger.info(
        {
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt
        },
        "Request completed"
      );
    });

    next();
  };
}
