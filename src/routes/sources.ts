import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DuckDBSource, type DeclaredFileType } from "../sources/duckdb-source.js";
import { createSqlSource } from "../sources/sql-source.js";
import { MongoSource } from "../sources/mongo-source.js";
import { assertConnectionStringHostIsAllowed } from "../sources/host-policy.js";
import { config } from "../config.js";
import {
  getProfileForOwner,
  registerSource,
  removeSourceForOwner,
  getSuggestedQuestionsForOwner,
  cacheSuggestedQuestionsForOwner,
} from "../sources/registry.js";
import { suggestQuestions } from "../agent/suggest-questions.js";
import { User } from "../models/user.js";
import { resolveLlm } from "../auth/llm-access.js";

const SUPPORTED_FILE_EXTENSIONS: Record<string, DeclaredFileType> = {
  csv: "csv",
  json: "json",
  xlsx: "xlsx",
  xls: "xls",
};

const dbSourceBodySchema = z.object({
  kind: z.enum(["postgres", "mysql", "sqlite", "mongodb"]),
  connectionString: z.string().min(1, "connectionString is required"),
});

function detectFileType(filename: string): DeclaredFileType | undefined {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (!extension) return undefined;
  return SUPPORTED_FILE_EXTENSIONS[extension];
}

/**
 * Registers all /sources routes: ingesting file uploads and database
 * connections into the in-memory source registry, and exposing their
 * cached schema profiles.
 */
export function registerSourceRoutes(app: FastifyInstance): void {
  app.post("/sources/file", { preHandler: [app.authenticate] }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "No file was uploaded." });
    }

    const declaredType = detectFileType(file.filename);
    if (!declaredType) {
      return reply.code(400).send({
        error: `Unsupported file extension for "${file.filename}". Expected one of: csv, json, xlsx, xls.`,
      });
    }

    try {
      const buffer = await file.toBuffer();
      const source = await DuckDBSource.create(buffer, file.filename, declaredType);
      const profile = await source.profile();
      const sourceId = await registerSource(source, profile, request.user.id, {
        kind: "file",
        buffer,
        originalFilename: file.filename,
        declaredType,
      });
      return reply.send({ sourceId, profile });
    } catch (error) {
      // @fastify/multipart aborts the stream (and throws with this code) when
      // the upload exceeds limits.fileSize; surface a clear size-limit message
      // instead of the opaque "request file too large".
      const message = error instanceof Error ? error.message : String(error);
      const tooLarge =
        (error as { code?: string })?.code === "FST_REQ_FILE_TOO_LARGE" ||
        /file too large/i.test(message);
      if (tooLarge) {
        const limitMb = Math.round(config.maxUploadBytes / (1024 * 1024));
        return reply.code(413).send({
          error: `That file is too large. The maximum upload size is ${limitMb} MB.`,
        });
      }
      return reply.code(400).send({
        error: `Failed to ingest file: ${message}`,
      });
    }
  });

  app.post("/sources/db", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = dbSourceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { kind, connectionString } = parsed.data;

    if (kind === "sqlite" && !config.allowFileDbSources) {
      return reply.code(400).send({
        error: "SQLite file-path connections are disabled on this deployment.",
      });
    }

    if (kind === "postgres" || kind === "mysql" || kind === "mongodb") {
      const hostPolicy = await assertConnectionStringHostIsAllowed(connectionString);
      if (!hostPolicy.allowed) {
        return reply.code(400).send({
          error: hostPolicy.reason ?? "This database host is not allowed.",
        });
      }
    }

    try {
      const source =
        kind === "mongodb" ? await MongoSource.create(connectionString) : createSqlSource(kind, connectionString);
      const profile = await source.profile();
      const sourceId = await registerSource(source, profile, request.user.id, { kind, connectionString });
      return reply.send({ sourceId, profile });
    } catch (error) {
      return reply.code(400).send({
        error: `Failed to connect to ${kind} database: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/sources/:id/profile",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const profile = await getProfileForOwner(request.params.id, request.user.id);
      if (!profile) {
        return reply.code(404).send({ error: `No source found with id "${request.params.id}".` });
      }
      return reply.send(profile);
    }
  );

  app.get<{ Params: { id: string } }>(
    "/sources/:id/suggested-questions",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const profile = await getProfileForOwner(id, request.user.id);
      if (!profile) {
        return reply.code(404).send({ error: `No source found with id "${id}".` });
      }

      const cached = await getSuggestedQuestionsForOwner(id, request.user.id);
      if (cached) {
        return reply.send({ questions: cached });
      }

      try {
        // Use the user's own LLM credentials if they've set them (so a
        // BYO-key user's provider is used). Suggested questions are an
        // incidental helper, so this never checks or consumes the free quota.
        const user = await User.findById(request.user.id);
        const { overrides } = user ? resolveLlm(user) : { overrides: {} };
        const questions = await suggestQuestions(profile, overrides);
        await cacheSuggestedQuestionsForOwner(id, request.user.id, questions);
        return reply.send({ questions });
      } catch (error) {
        return reply.code(500).send({
          error: "Failed to generate suggested questions.",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/sources/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const removed = await removeSourceForOwner(request.params.id, request.user.id);
      if (!removed) {
        return reply.code(404).send({ error: `No source found with id "${request.params.id}".` });
      }
      return reply.code(204).send();
    }
  );
}

export default registerSourceRoutes;
