import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

// The user store persists via Mongoose, so spin up an in-memory MongoDB
// instance and point config.mongoDbUri at it before anything under test
// is imported, keeping this suite isolated from any real database.
let mongoServer: MongoMemoryServer;

// Pin an older, much smaller binary than the current default so the
// first-run download (this sandbox has no local mongod to reuse) completes
// in a reasonable amount of time; any 4.x+ server works fine with Mongoose.
process.env.MONGOMS_VERSION ??= "4.4.29";
process.env.JWT_SECRET = "test-secret";

let app: FastifyInstance;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const mod = await import("../src/server.js");
  app = mod.default;

  const { connectMongo } = await import("../src/db/mongo.js");
  await connectMongo();

  await app.ready();
}, 600_000);

afterAll(async () => {
  await app?.close();
  await mongoose.disconnect();
  await mongoServer?.stop();
}, 60_000);

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe("auth routes", () => {
  it("registers then logs in successfully, returning a token", async () => {
    const email = uniqueEmail();
    const password = "correct-horse-battery-staple";

    const registerResponse = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password },
    });
    expect(registerResponse.statusCode).toBe(200);
    expect(registerResponse.json().token).toBeTypeOf("string");

    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json().token).toBeTypeOf("string");
  });

  it("rejects duplicate registration with 409", async () => {
    const email = uniqueEmail();
    const password = "correct-horse-battery-staple";

    const first = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password },
    });
    expect(second.statusCode).toBe(409);
  });

  it("rejects login with the wrong password with 401", async () => {
    const email = uniqueEmail();
    const password = "correct-horse-battery-staple";

    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "totally-wrong-password" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("protected route access", () => {
  it("rejects a protected route with no Authorization header with 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
    });
    expect(response.statusCode).toBe(401);
  });

  it("does not let user A access a source created by user B (404)", async () => {
    const passwordA = "user-a-password-123";
    const passwordB = "user-b-password-123";
    const emailA = uniqueEmail();
    const emailB = uniqueEmail();

    const registerA = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: emailA, password: passwordA },
    });
    const tokenA = registerA.json().token as string;

    const registerB = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: emailB, password: passwordB },
    });
    const tokenB = registerB.json().token as string;

    const csv = "name,amount\nAlice,10\nBob,20\n";
    const boundary = "----datasenseTestBoundary";
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="people.csv"\r\n` +
      `Content-Type: text/csv\r\n\r\n` +
      `${csv}\r\n` +
      `--${boundary}--\r\n`;

    const uploadResponse = await app.inject({
      method: "POST",
      url: "/sources/file",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(uploadResponse.statusCode).toBe(200);
    const sourceId = uploadResponse.json().sourceId as string;

    const profileResponse = await app.inject({
      method: "GET",
      url: `/sources/${sourceId}/profile`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(profileResponse.statusCode).toBe(404);
  });
});
