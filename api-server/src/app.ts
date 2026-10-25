import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { ZodError } from "zod/v4";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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

const backend = process.env.MARKET_BACKEND || "database";
if (!["database", "solana"].includes(backend)) throw new Error("MARKET_BACKEND must be database or solana");
app.get("/api/runtime", (_req, res) => res.json({ backend, solanaProgramId: process.env.SOLANA_PROGRAM_ID || "EiMn8BEsdfuxEedNGi2vr12cjbKhGpq5Bq5N2ecCdnnM" }));
app.use("/api", (req, res, next) => {
  if (backend === "solana" && /^\/(markets|wallet|trades|liquidity|leaderboard)(\/|$)/.test(req.path)) {
    return void res.status(503).json({ error: "Financial state is on Solana. Use the wallet client and chain indexer.", backend });
  }
  next();
}, router);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof ZodError ? 400 : err.status || 500;
  if (status >= 500) logger.error({ err }, "Request failed");
  res.status(status).json({ error: status >= 500 ? "Request failed" : err instanceof ZodError ? err.issues.map(i => i.message).join("; ") : err.message });
});
export default app;
