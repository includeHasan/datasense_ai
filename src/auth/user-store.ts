import { User, type UserShape } from "../models/user.js";

interface MongoDuplicateKeyError extends Error {
  code?: number;
}

function isDuplicateKeyError(error: unknown): error is MongoDuplicateKeyError {
  return (
    error instanceof Error &&
    typeof (error as MongoDuplicateKeyError).code === "number" &&
    (error as MongoDuplicateKeyError).code === 11000
  );
}

function toUserShape(doc: {
  _id: unknown;
  email: string;
  passwordHash: string;
  createdAt: Date;
}): UserShape {
  return {
    id: String(doc._id),
    email: doc.email,
    passwordHash: doc.passwordHash,
    createdAt: doc.createdAt,
  };
}

/**
 * Creates a new user document. Throws a clear error (rather than the raw
 * Mongo duplicate-key error) if the email is already registered, so the
 * route layer can map it to a 409 response.
 */
export async function createUser(params: { email: string; passwordHash: string }): Promise<UserShape> {
  try {
    const doc = await User.create({ email: params.email, passwordHash: params.passwordHash });
    return toUserShape(doc);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new Error(`A user with email "${params.email}" already exists.`);
    }
    throw error;
  }
}

export async function findByEmail(email: string): Promise<UserShape | undefined> {
  const doc = await User.findOne({ email }).lean();
  return doc ? toUserShape(doc) : undefined;
}

export async function findById(id: string): Promise<UserShape | undefined> {
  const doc = await User.findById(id).lean().catch(() => undefined);
  return doc ? toUserShape(doc) : undefined;
}

export default { createUser, findByEmail, findById };
