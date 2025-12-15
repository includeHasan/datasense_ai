import mongoose from "mongoose";
import { config } from "../config.js";

let connectPromise: Promise<typeof mongoose> | undefined;

/**
 * Connects to MongoDB via Mongoose using config.mongoDbUri. Idempotent -
 * repeated calls reuse the in-flight/established connection rather than
 * reconnecting. Does not exit the process on failure; it logs a clear
 * error and rethrows so the caller (server startup) can decide whether to
 * exit.
 */
export async function connectMongo(): Promise<typeof mongoose> {
  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = mongoose.connect(config.mongoDbUri).catch((error: unknown) => {
    connectPromise = undefined;
    console.error(
      `Failed to connect to MongoDB at "${config.mongoDbUri}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  });

  return connectPromise;
}

export default connectMongo;
