import mongoose, { type InferSchemaType, type HydratedDocument } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Persisted metadata for a registered data source, so ANY server instance
 * (not just the one that originally registered it) can reconstruct a live
 * DataSource on demand - see src/sources/registry.ts. This is the actual
 * source of truth in a multi-instance deployment; the in-memory registry Map
 * is only a per-process cache in front of it.
 *
 * - SQL kinds ("postgres" | "mysql" | "sqlite") and "mongodb" store just the
 *   connectionString - reconnecting is cheap and stateless.
 * - "file" kind sources cannot store the ingested data itself (it lives in a
 *   throwaway in-memory DuckDB instance), so instead the ORIGINAL uploaded
 *   file bytes are stored in GridFS (see src/sources/gridfs.ts) and
 *   `gridFsFileId` points at them. Reconstructing a "file" source means
 *   re-downloading those bytes and re-running them through
 *   DuckDBSource.create - i.e. redoing the original ingestion, not restoring
 *   a snapshot of the live database.
 *
 * The computed SchemaProfile is cached here too so profile-only requests
 * (GET /sources/:id/profile) never need to reconstruct a full DataSource.
 */
const sourceSchema = new Schema({
  ownerId: {
    type: String,
    required: true,
    index: true,
  },
  kind: {
    type: String,
    required: true,
    enum: ["file", "postgres", "mysql", "sqlite", "mongodb"],
  },
  connectionString: {
    type: String,
    required: false,
  },
  gridFsFileId: {
    type: Schema.Types.ObjectId,
    required: false,
  },
  originalFilename: {
    type: String,
    required: false,
  },
  declaredType: {
    type: String,
    required: false,
  },
  profile: {
    type: Schema.Types.Mixed,
    required: true,
  },
  suggestedQuestions: {
    type: [String],
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export type SourceDocument = HydratedDocument<InferSchemaType<typeof sourceSchema>>;

/**
 * Plain-object shape callers work with, mirroring the pattern used by
 * UserShape/ConversationShape - Mongo's `_id` is mapped to a string `id` so
 * consumers do not need to change how they access fields.
 */
export interface SourceShape {
  id: string;
  ownerId: string;
  kind: "file" | "postgres" | "mysql" | "sqlite" | "mongodb";
  connectionString?: string;
  gridFsFileId?: mongoose.Types.ObjectId;
  originalFilename?: string;
  declaredType?: string;
  profile: unknown;
  suggestedQuestions?: string[];
  createdAt: Date;
}

// Reuse an existing compiled model when this module is evaluated more than
// once (e.g. under test hot-reload) to avoid Mongoose's "OverwriteModelError".
export const Source = models.Source ?? model("Source", sourceSchema);

export default Source;
