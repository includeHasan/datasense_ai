import mongoose, { type InferSchemaType, type HydratedDocument } from "mongoose";

const { Schema, model, models } = mongoose;

const messageSchema = new Schema({
  conversationId: {
    type: String,
    required: true,
    index: true,
  },
  role: {
    type: String,
    enum: ["user", "assistant"],
    required: true,
  },
  question: {
    type: String,
    required: false,
  },
  answer: {
    type: Schema.Types.Mixed,
    required: false,
  },
  // Reserved for a later streaming-trace stage (e.g. per-node agent trace
  // events); not populated by the current synchronous invoke path.
  trace: {
    type: Schema.Types.Mixed,
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export type MessageDocument = HydratedDocument<InferSchemaType<typeof messageSchema>>;

export type MessageRole = "user" | "assistant";

/**
 * Plain-object shape callers work with, mirroring the pattern used by
 * UserShape/ConversationShape.
 */
export interface MessageShape {
  id: string;
  conversationId: string;
  role: MessageRole;
  question?: string;
  answer?: unknown;
  trace?: unknown;
  createdAt: Date;
}

// Reuse an existing compiled model when this module is evaluated more than
// once (e.g. under test hot-reload) to avoid Mongoose's "OverwriteModelError".
export const Message = models.Message ?? model("Message", messageSchema);

export default Message;
