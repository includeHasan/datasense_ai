import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { createUser, findByEmail } from "./user-store.js";

const credentialsBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const PASSWORD_SALT_ROUNDS = 10;

/**
 * Registers the /auth routes: registration, login, and the authenticated
 * "who am I" endpoint used by the frontend to restore a session from a JWT.
 */
export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/auth/register", async (request, reply) => {
    const parsed = credentialsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;

    try {
      const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
      const user = await createUser({ email, passwordHash });
      const token = app.jwt.sign({ id: user.id, email: user.email });
      return reply.send({ token, user: { id: user.id, email: user.email } });
    } catch (error) {
      if (error instanceof Error && /already exists/.test(error.message)) {
        return reply.code(409).send({ error: "An account with this email already exists." });
      }
      return reply.code(500).send({
        error: `Failed to register: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = credentialsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;

    const user = await findByEmail(email);
    if (!user) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }

    const token = app.jwt.sign({ id: user.id, email: user.email });
    return reply.send({ token, user: { id: user.id, email: user.email } });
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    return reply.send({ user: request.user });
  });
}

export default registerAuthRoutes;
