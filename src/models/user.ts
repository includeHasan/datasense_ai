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
}

// Reuse an existing compiled model when this module is evaluated more than
// once (e.g. under test hot-reload) to avoid Mongoose's "OverwriteModelError".
export const User = models.User ?? model("User", userSchema);

export default User;
