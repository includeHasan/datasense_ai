import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Conversation } from "../models/conversation.js";
import { Message } from "../models/message.js";

const createConversationBodySchema = z.object({
  sourceId: z.string().optional(),
  title: z.string().optional(),
});

/**
 * Looks up a conversation by id, but only if it is owned by the given
 * userId. Returns null both when the conversation does not exist and when
 * it belongs to a different owner, so callers can respond with a uniform
 * 404 instead of leaking existence of other users' conversations (mirrors
 * the getSourceForOwner/getProfileForOwner convention in sources/registry.ts).
 */
async function getConversationForOwner(conversationId: string, userId: string) {
  const conversation = await Conversation.findById(conversationId).catch(() => null);
  if (!conversation || conversation.userId !== userId) return null;
  return conversation;
}

/**
 * Registers the /conversations routes: create/list/get/delete per-user
 * conversations backed by MongoDB. All routes require authentication.
 */
export function registerConversationRoutes(app: FastifyInstance): void {
  app.post("/conversations", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = createConversationBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const conversation = await Conversation.create({
      userId: request.user.id,
      sourceId: parsed.data.sourceId,
      title: parsed.data.title ?? "New conversation",
    });

    return reply.send({
      id: String(conversation._id),
      title: conversation.title,
      sourceId: conversation.sourceId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    });
  });

  app.get("/conversations", { preHandler: [app.authenticate] }, async (request, reply) => {
    const conversations = await Conversation.find({ userId: request.user.id })
      .sort({ updatedAt: -1 })
      .select({ title: 1, updatedAt: 1 })
      .lean();

    return reply.send(
      conversations.map((conversation) => ({
        id: String(conversation._id),
        title: conversation.title,
        updatedAt: conversation.updatedAt,
      })),
    );
  });

  app.get<{ Params: { id: string } }>(
    "/conversations/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const conversation = await getConversationForOwner(request.params.id, request.user.id);
      if (!conversation) {
        return reply.code(404).send({ error: `No conversation found with id "${request.params.id}".` });
      }

      const messages = await Message.find({ conversationId: String(conversation._id) })
        .sort({ createdAt: 1 })
        .lean();

      return reply.send({
        id: String(conversation._id),
        title: conversation.title,
        sourceId: conversation.sourceId,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: messages.map((message) => ({
          id: String(message._id),
          role: message.role,
          question: message.question,
          answer: message.answer,
          trace: message.trace,
          createdAt: message.createdAt,
        })),
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/conversations/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const conversation = await getConversationForOwner(request.params.id, request.user.id);
      if (!conversation) {
        return reply.code(404).send({ error: `No conversation found with id "${request.params.id}".` });
      }

      await Message.deleteMany({ conversationId: String(conversation._id) });
      await Conversation.deleteOne({ _id: conversation._id });

      return reply.send({ ok: true });
    },
  );
}

export default registerConversationRoutes;
