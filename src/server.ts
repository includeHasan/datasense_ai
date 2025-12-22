import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { config } from "./config.js";
import { connectMongo } from "./db/mongo.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerAskRoute } from "./routes/ask.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerDemoRoutes } from "./routes/demo.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerDashboardRoutes } from "./routes/dashboards.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: config.frontendOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
});

await app.register(jwt, { secret: config.jwtSecret });

app.decorate("authenticate", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: "Unauthorized" });
  }
});

await app.register(multipart, {
  // Without an explicit limit, @fastify/multipart caps uploads at 1MB and
  // rejects larger datasets with "request file too large". Raise it to the
  // configured ceiling so real-world files (up to the product's ~100MB target)
  // can be ingested.
  limits: { fileSize: config.maxUploadBytes },
});

registerAuthRoutes(app);
registerAccountRoutes(app);
registerSourceRoutes(app);
registerAskRoute(app);
registerConversationRoutes(app);
registerDashboardRoutes(app);
await registerReportRoutes(app);
await registerDemoRoutes(app);

app.get("/health", async () => {
  return { status: "ok" };
});

export async function run(): Promise<void> {
  try {
    await connectMongo();
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href;

if (isMain) {
  void run();
}

export default app;
