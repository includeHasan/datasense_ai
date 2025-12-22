import mongoose, { type InferSchemaType, type HydratedDocument } from "mongoose";

const { Schema, model, models } = mongoose;

const userSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // --- Bring-your-own LLM credentials (encrypted at rest) ---
  // Presence of llmApiKeyEnc = "user has their own key" (unlimited usage).
  llmApiKeyEnc: {
    type: String,
  },
  llmBaseUrl: {
    type: String,
  },
  llmModel: {
    type: String,
  },
  // --- Free-tier monthly quota (app OPENAI_API_KEY) ---
  // Calendar month the count applies to, "YYYY-MM" (UTC). A mismatch with the
  // current month means the allowance has reset.
  quotaMonth: {
    type: String,
  },
  quotaCount: {
    type: Number,
    default: 0,
  },
});

export type UserDocument = HydratedDocument<InferSchemaType<typeof userSchema>>;

/**
 * Plain-object shape callers work with, mirroring what the previous
 * sqlite-backed store returned (minus the snake_case column names) -
 * Mongo's `_id` is mapped to a string `id` so consumers do not need to
 * change how they access fields.
 */
export interface UserShape {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  llmApiKeyEnc?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  quotaMonth?: string;
  quotaCount?: number;
}

// Reuse an existing compiled model when this module is evaluated more than
// once (e.g. under test hot-reload) to avoid Mongoose's "OverwriteModelError".
export const User = models.User ?? model("User", userSchema);

export default User;
