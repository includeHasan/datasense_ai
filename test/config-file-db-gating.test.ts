import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the ALLOW_FILE_DB_SOURCES config flag parsing in isolation
// (default-disabled vs. explicitly-enabled), by reimporting the config
// module fresh with different env values each time.
describe("config: ALLOW_FILE_DB_SOURCES", () => {
  const originalValue = process.env.ALLOW_FILE_DB_SOURCES;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.ALLOW_FILE_DB_SOURCES;
    } else {
      process.env.ALLOW_FILE_DB_SOURCES = originalValue;
    }
  });

  it("defaults to false when unset", async () => {
    delete process.env.ALLOW_FILE_DB_SOURCES;
    const { config } = await import("../src/config.js");
    expect(config.allowFileDbSources).toBe(false);
  });

  it("defaults to false for any value other than the literal string 'true'", async () => {
    process.env.ALLOW_FILE_DB_SOURCES = "yes";
    const { config } = await import("../src/config.js");
    expect(config.allowFileDbSources).toBe(false);
  });

  it("is true when explicitly set to 'true'", async () => {
    process.env.ALLOW_FILE_DB_SOURCES = "true";
    const { config } = await import("../src/config.js");
    expect(config.allowFileDbSources).toBe(true);
  });

  it("parses ALLOWED_INTERNAL_DB_HOSTS as a trimmed, filtered comma-separated list", async () => {
    process.env.ALLOWED_INTERNAL_DB_HOSTS = " host-a ,host-b,,host-c ";
    const { config } = await import("../src/config.js");
    expect(config.allowedInternalDbHosts).toEqual(["host-a", "host-b", "host-c"]);
    delete process.env.ALLOWED_INTERNAL_DB_HOSTS;
  });

  it("defaults ALLOWED_INTERNAL_DB_HOSTS to an empty list when unset", async () => {
    delete process.env.ALLOWED_INTERNAL_DB_HOSTS;
    const { config } = await import("../src/config.js");
    expect(config.allowedInternalDbHosts).toEqual([]);
  });
});
