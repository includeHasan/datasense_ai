import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Dashboard } from "../models/dashboard.js";

const pinBodySchema = z.object({
  chartSpec: z.unknown().optional(),
  narrative: z.string().optional(),
  sourceId: z.string().optional(),
  question: z.string().optional(),
});

/**
 * Looks up a dashboard by id, but only if it is owned by the given userId.
 * Returns null both when the dashboard does not exist and when it belongs
 * to a different owner, so callers can respond with a uniform 404 instead
 * of leaking existence of other users' dashboards (mirrors
 * getConversationForOwner in conversations.ts).
 */
async function getDashboardForOwner(dashboardId: string, userId: string) {
  const dashboard = await Dashboard.findById(dashboardId).catch(() => null);
  if (!dashboard || dashboard.userId !== userId) return null;
  return dashboard;
}

function serializeDashboard(dashboard: {
  _id: unknown;
  title: string;
  items: Array<{ _id: unknown; chartSpec?: unknown; narrative?: string; sourceId?: string; question?: string; pinnedAt: Date }>;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}) {
  return {
    id: String(dashboard._id),
    userId: dashboard.userId,
    title: dashboard.title,
    items: dashboard.items.map((item) => ({
      id: String(item._id),
      chartSpec: item.chartSpec,
      narrative: item.narrative,
      sourceId: item.sourceId,
      question: item.question,
      pinnedAt: item.pinnedAt,
    })),
    createdAt: dashboard.createdAt,
    updatedAt: dashboard.updatedAt,
  };
}

/**
 * Registers the /dashboards routes. Users get a single personal dashboard
 * (created lazily on first GET) rather than multiple dashboards - this
 * keeps the MVP scope of "pin an answer for recurring monitoring" simple,
 * with no dashboard-management UI (create/rename/delete-dashboard) needed.
 * All routes require authentication.
 */
export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get("/dashboards", { preHandler: [app.authenticate] }, async (request, reply) => {
    let dashboard = await Dashboard.findOne({ userId: request.user.id });
    if (!dashboard) {
      dashboard = await Dashboard.create({ userId: request.user.id });
    }

    return reply.send(serializeDashboard(dashboard));
  });

  app.post<{ Params: { id: string } }>(
    "/dashboards/:id/pins",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const parsed = pinBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const dashboard = await getDashboardForOwner(request.params.id, request.user.id);
      if (!dashboard) {
        return reply.code(404).send({ error: `No dashboard found with id "${request.params.id}".` });
      }

      dashboard.items.push({
        chartSpec: parsed.data.chartSpec,
        narrative: parsed.data.narrative,
        sourceId: parsed.data.sourceId,
        question: parsed.data.question,
        pinnedAt: new Date(),
      });
      dashboard.updatedAt = new Date();
      await dashboard.save();

      return reply.send(serializeDashboard(dashboard));
    },
  );

  app.delete<{ Params: { id: string; pinId: string } }>(
    "/dashboards/:id/pins/:pinId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const dashboard = await getDashboardForOwner(request.params.id, request.user.id);
      if (!dashboard) {
        return reply.code(404).send({ error: `No dashboard found with id "${request.params.id}".` });
      }

      const item = dashboard.items.id(request.params.pinId);
      if (!item) {
        return reply.code(404).send({ error: `No pinned item found with id "${request.params.pinId}".` });
      }
      item.deleteOne();
      dashboard.updatedAt = new Date();
      await dashboard.save();

      return reply.send(serializeDashboard(dashboard));
    },
  );
}

export default registerDashboardRoutes;
