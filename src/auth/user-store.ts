import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

mkdirSync(dirname(config.usersDbPath), { recursive: true });

const db = new Database(config.usersDbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

/**
 * Creates a new user row. Throws a clear error (rather than the raw
 * better-sqlite3 constraint error) if the email is already registered,
 * so the route layer can map it to a 409 response.
 */
export function createUser(params: { email: string; passwordHash: string }): User {
  const user: User = {
    id: randomUUID(),
    email: params.email,
    password_hash: params.passwordHash,
    created_at: new Date().toISOString(),
  };

  try {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (@id, @email, @password_hash, @created_at)"
    ).run(user);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw new Error(`A user with email "${params.email}" already exists.`);
    }
    throw error;
  }

  return user;
}

export function findByEmail(email: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;
}

export function findById(id: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

export default { createUser, findByEmail, findById };
