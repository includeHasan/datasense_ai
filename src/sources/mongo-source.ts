import type { DataSource, QueryResult, SchemaProfile } from "./types.js";

/**
 * Stub adapter proving that the DataSource abstraction can accommodate a
 * future non-SQL (MongoDB) implementation. No real MongoDB driver is used;
 * all data-access methods intentionally throw.
 */
export class MongoSource implements DataSource {
  readonly id: string;
  readonly kind = "mongodb" as const;
  readonly dialect = "mongodb" as const;

  private readonly connectionString: string;

  constructor(connectionString: string, id: string = "mongodb") {
    this.connectionString = connectionString;
    this.id = id;
  }

  async profile(): Promise<SchemaProfile> {
    throw new Error("MongoDB support is not implemented yet");
  }

  async execute(_query: string): Promise<QueryResult> {
    throw new Error("MongoDB support is not implemented yet");
  }

  async close(): Promise<void> {
    throw new Error("MongoDB support is not implemented yet");
  }
}
