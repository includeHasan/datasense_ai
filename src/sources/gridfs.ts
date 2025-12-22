import { Readable } from "node:stream";
import mongoose from "mongoose";

const BUCKET_NAME = "sourceFiles";

/**
 * Lazily resolves a GridFSBucket bound to the current Mongoose connection.
 * Must only be called once Mongoose is connected (see src/db/mongo.ts) -
 * every call site in this module is only reached from registry functions
 * that are themselves only invoked after server startup has connected.
 */
function getBucket(): mongoose.mongo.GridFSBucket {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Cannot access GridFS before Mongoose has connected.");
  }
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET_NAME });
}

/**
 * Uploads a raw file buffer (an uploaded CSV/JSON/XLSX's original bytes) to
 * GridFS so it can be re-ingested into a fresh DuckDB instance later, on any
 * server instance - this is what makes a "file" kind source reconstructible
 * without keeping the whole dataset in one process's RAM forever.
 *
 * Tradeoff (documented, not fixed here): GridFS chunks and reassembles the
 * buffer through MongoDB itself, which is fine for typical uploaded
 * CSV/JSON/XLSX sizes (the app's own MVP scope bounds files to roughly
 * 100MB / millions of rows) but is meaningfully slower than local disk or an
 * object store like S3 for very large files, both to upload and to download
 * again on a cache-miss reconstruction. It is a reasonable choice here only
 * because it reuses the MongoDB dependency the app already has instead of
 * introducing a new piece of infrastructure.
 */
export async function uploadToGridFs(
  buffer: Buffer,
  filename: string,
): Promise<mongoose.Types.ObjectId> {
  const bucket = getBucket();
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename);
    Readable.from(buffer)
      .pipe(uploadStream)
      .on("error", reject)
      .on("finish", () => resolve(uploadStream.id as mongoose.Types.ObjectId));
  });
}

/**
 * Downloads a previously-uploaded file's bytes back out of GridFS, e.g. when
 * a "file" kind source needs to be reconstructed on an instance that doesn't
 * have it in its local cache.
 */
export async function downloadFromGridFs(fileId: mongoose.Types.ObjectId): Promise<Buffer> {
  const bucket = getBucket();
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    bucket
      .openDownloadStream(fileId)
      .on("data", (chunk: Buffer) => chunks.push(chunk))
      .on("error", reject)
      .on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Deletes a previously-uploaded file's bytes and its chunks from GridFS,
 * e.g. when a "file" kind source is removed or evicted after its TTL.
 */
export async function deleteFromGridFs(fileId: mongoose.Types.ObjectId): Promise<void> {
  const bucket = getBucket();
  await bucket.delete(fileId);
}
