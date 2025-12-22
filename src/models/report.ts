import mongoose, { type InferSchemaType, type HydratedDocument } from "mongoose";

const { Schema, model, models } = mongoose;

const reportSchema = new Schema({
  ownerId: {
    type: String,
    required: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    default: "Generated report",
  },
  // The array of report sections ({ title, narrative, chartSpec, sampleRows }).
  // Stored as Mixed since section shapes (chart specs especially) are
  // free-form JSON validated upstream, mirroring how dashboard items persist
  // their chartSpec.
  sections: {
    type: Schema.Types.Mixed,
    required: true,
    default: [],
  },
  // The source/conversation that produced this report, when known - lets a
  // future UI re-run or trace a report back to its origin.
  sourceId: {
    type: String,
    required: false,
  },
  conversationId: {
    type: String,
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export type ReportDocument = HydratedDocument<InferSchemaType<typeof reportSchema>>;

/**
 * One section of a saved report, mirroring src/reports/builder.ts's
 * ReportSection.
 */
export interface ReportSectionShape {
  title: string;
  narrative: string;
  chartSpec: unknown;
  sampleRows: Record<string, unknown>[];
}

/**
 * Plain-object shape callers work with, mirroring the pattern used by
 * ConversationShape/DashboardShape - Mongo's `_id` is mapped to a string `id`
 * so consumers do not need to change how they access fields.
 */
export interface ReportShape {
  id: string;
  ownerId: string;
  title: string;
  sections: ReportSectionShape[];
  sourceId?: string;
  conversationId?: string;
  createdAt: Date;
}

// Reuse an existing compiled model when this module is evaluated more than
// once (e.g. under test hot-reload) to avoid Mongoose's "OverwriteModelError".
export const Report = models.Report ?? model("Report", reportSchema);

export default Report;
