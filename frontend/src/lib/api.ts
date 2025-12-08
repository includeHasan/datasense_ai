import type { AuthUser, FinalAnswer, SchemaProfile } from "./types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ZodFlattenLike {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
}

function isZodFlattenLike(value: unknown): value is ZodFlattenLike {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return "formErrors" in v || "fieldErrors" in v;
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) {
    return fallback;
  }

  const record = body as Record<string, unknown>;
  const error = record.error;
  const detail = record.detail;

  if (typeof error === "string") {
    if (typeof detail === "string" && detail.length > 0) {
      return `${error}: ${detail}`;
    }
    return error;
  }

  if (isZodFlattenLike(error)) {
    const messages: string[] = [];
    if (error.formErrors && error.formErrors.length > 0) {
      messages.push(...error.formErrors);
    }
    if (error.fieldErrors) {
      for (const [field, fieldMessages] of Object.entries(error.fieldErrors)) {
        if (fieldMessages && fieldMessages.length > 0) {
          messages.push(`${field}: ${fieldMessages.join(", ")}`);
        }
      }
    }
    if (messages.length > 0) {
      return messages.join("; ");
    }
  }

  return fallback;
}

function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Please define it in your .env.local file."
    );
  }
  return url;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // response body was not JSON; fall through with null body
    }
    const message = extractErrorMessage(
      body,
      `Request failed with status ${response.status}`
    );
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export async function register(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  const response = await fetch(`${getApiBaseUrl()}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return handleResponse(response);
}

export async function login(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return handleResponse(response);
}

export async function me(token: string): Promise<{ user: AuthUser }> {
  const response = await fetch(`${getApiBaseUrl()}/auth/me`, {
    method: "GET",
    headers: authHeaders(token),
  });
  return handleResponse(response);
}

export async function uploadFile(
  token: string,
  file: File
): Promise<{ sourceId: string; profile: SchemaProfile }> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${getApiBaseUrl()}/sources/file`, {
    method: "POST",
    headers: authHeaders(token),
    body: formData,
  });
  return handleResponse(response);
}

export async function connectDb(
  token: string,
  kind: string,
  connectionString: string
): Promise<{ sourceId: string; profile: SchemaProfile }> {
  const response = await fetch(`${getApiBaseUrl()}/sources/db`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ kind, connectionString }),
  });
  return handleResponse(response);
}

export async function getProfile(
  token: string,
  sourceId: string
): Promise<SchemaProfile> {
  const response = await fetch(
    `${getApiBaseUrl()}/sources/${sourceId}/profile`,
    {
      method: "GET",
      headers: authHeaders(token),
    }
  );
  return handleResponse(response);
}

export async function getSuggestedQuestions(
  token: string,
  sourceId: string
): Promise<{ questions: string[] }> {
  const response = await fetch(
    `${getApiBaseUrl()}/sources/${sourceId}/suggested-questions`,
    {
      method: "GET",
      headers: authHeaders(token),
    }
  );
  return handleResponse(response);
}

export async function ask(
  token: string,
  sourceId: string,
  question: string
): Promise<FinalAnswer> {
  const response = await fetch(`${getApiBaseUrl()}/sources/${sourceId}/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ question }),
  });
  return handleResponse(response);
}

// --- Public demo endpoints (no auth required) ---

export async function getDemoProfile(): Promise<SchemaProfile> {
  const response = await fetch(`${getApiBaseUrl()}/demo/profile`, {
    method: "GET",
  });
  return handleResponse(response);
}

export async function getDemoSuggestedQuestions(): Promise<{
  questions: string[];
}> {
  const response = await fetch(`${getApiBaseUrl()}/demo/suggested-questions`, {
    method: "GET",
  });
  return handleResponse(response);
}

export async function demoAsk(question: string): Promise<FinalAnswer> {
  const response = await fetch(`${getApiBaseUrl()}/demo/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  return handleResponse(response);
}

export async function deleteSource(
  token: string,
  sourceId: string
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/sources/${sourceId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return handleResponse(response);
}
