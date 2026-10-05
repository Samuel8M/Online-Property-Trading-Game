import express, { type Express } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Hosts (Render, Replit, Fly) terminate TLS at a proxy; trust its first hop so
// req.ip is the visitor's address and per-IP room creation limits work.
app.set("trust proxy", Number(process.env["TRUST_PROXY_HOPS"] ?? 1));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Single-service hosting: serve the built web client when it is present.
const staticDir = path.resolve(
  process.env["STATIC_DIR"] ?? path.join(process.cwd(), "artifacts/property-pursuit/dist/public"),
);
if (existsSync(path.join(staticDir, "index.html"))) {
  app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
  logger.info({ staticDir }, "Serving web client");
}

export default app;
