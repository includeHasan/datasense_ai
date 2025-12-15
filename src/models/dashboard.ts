import mongoose, { type InferSchemaType, type HydratedDocument } from "mongoose";

const { Schema, model, models } = mongoose;

const dashboardItemSchema = new Schema(
  {
    chartSpec: {
      type: Schema.Types.Mixed,
      required: false,
    },
    narrative: {
      type: String,
      required: false,
    },
    sourceId: {
      type: String,
      required: false,
    },
    question: {
      type: String,
      required: false,
    },
    pinnedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

const dashboardSchema = new Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    default: "My Dashboard",
  },
  items: {
    type: [dashboardItemSchema],
    default: [],
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

export type DashboardDocument = HydratedDocument<InferSchemaType<typeof dashboardSchema>>;

/**
 * Plain-object shape callers work with, mirroring the pattern used by
 * ConversationShape/MessageShape - Mongo's `_id` is mapped to a string `id`
 * so consumers do not need to change how they access fields.
 */
export interface DashboardItemShape {
  id: string;
  chartSpec?: unknown;
  narrative?: string;
  sourceId?: string;
  question?: string;
  pinnedAt: Date;
}

export interface DashboardShape {
  id: string;
  userId: string;
  title: string;
  items: DashboardItemShape[];
  createdAt: Date;
  updatedAt: Date;
}

// Reuse an existing compiled model when this module is evaluated more than
// once (e.g. under test hot-reload) to avoid Mongoose's "OverwriteModelError".
export const Dashboard = models.Dashboard ?? model("Dashboard", dashboardSchema);

export default Dashboard;
