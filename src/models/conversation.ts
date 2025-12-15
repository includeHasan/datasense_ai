import mongoose, { type InferSchemaType, type HydratedDocument } from "mongoose";

const { Schema, model, models } = mongoose;

const conversationSchema = new Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  sourceId: {
    type: String,
    required: false,
  },
  title: {
    type: String,
    required: true,
    default: "New conversation",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export type ConversationDocument = HydratedDocument<InferSchemaType<typeof conversationSchema>>;

/**
 * Plain-object shape callers work with, mirroring the pattern used by
 * UserShape - Mongo's `_id` is mapped to a string `id` so consumers do not
 * need to change how they access fields.
 */
export interface ConversationShape {
  id: string;
  userId: string;
  sourceId?: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

// Reuse an existing compiled model when this module is evaluated more than
// once (e.g. under test hot-reload) to avoid Mongoose's "OverwriteModelError".
export const Conversation = models.Conversation ?? model("Conversation", conversationSchema);

export default Conversation;
