import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep these tests fully isolated from real DNS/network activity: dns.promises.lookup
// is mocked per-test below so hostname-resolution cases are deterministic.
vi.mock("node:dns", () => {
  const lookup = vi.fn();
  return {
    default: { promises: { lookup } },
    promises: { lookup },
  };
});

describe("host-policy", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.ALLOWED_INTERNAL_DB_HOSTS;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("extractHostname", () => {
    it("extracts the host from a postgres:// URI", async () => {
      const { extractHostname } = await import("../src/sources/host-policy.js");
      expect(extractHostname("postgres://user:pass@db.example.com:5432/mydb")).toBe(
        "db.example.com",
      );
    });

    it("extracts the host from a mysql:// URI", async () => {
      const { extractHostname } = await import("../src/sources/host-policy.js");
      expect(extractHostname("mysql://root@127.0.0.1:3306/app")).toBe("127.0.0.1");
    });

    it("falls back to a regex for non-standard-scheme strings", async () => {
      const { extractHostname } = await import("../src/sources/host-policy.js");
      expect(extractHostname("weirdscheme://internal-host/db")).toBe("internal-host");
    });
  });

  describe("isPrivateOrInternalIp", () => {
    it.each([
      ["127.0.0.1", true],
      ["10.1.2.3", true],
      ["172.16.5.5", true],
      ["192.168.0.10", true],
      ["169.254.169.254", true], // cloud metadata endpoint
      ["::1", true],
      ["fc00::1", true],
      ["fe80::1", true],
      ["8.8.8.8", false],
      ["93.184.216.34", false],
    ])("classifies %s as private=%s", async (ip, expected) => {
      const { isPrivateOrInternalIp } = await import("../src/sources/host-policy.js");
      expect(isPrivateOrInternalIp(ip)).toBe(expected);
    });
  });

  describe("assertConnectionStringHostIsAllowed", () => {
    it("rejects an IP-literal connection string pointing at loopback without any DNS lookup", async () => {
      const dns = await import("node:dns");
      const { assertConnectionStringHostIsAllowed } = await import("../src/sources/host-policy.js");

      const result = await assertConnectionStringHostIsAllowed("postgres://127.0.0.1:5432/db");

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/internal\/private host/i);
      expect(dns.promises.lookup).not.toHaveBeenCalled();
    });

    it("rejects a cloud-metadata IP literal", async () => {
      const { assertConnectionStringHostIsAllowed } = await import("../src/sources/host-policy.js");
      const result = await assertConnectionStringHostIsAllowed(
        "mysql://169.254.169.254:3306/db",
      );
      expect(result.allowed).toBe(false);
    });

    it("allows a public IP literal", async () => {
      const { assertConnectionStringHostIsAllowed } = await import("../src/sources/host-policy.js");
      const result = await assertConnectionStringHostIsAllowed("postgres://8.8.8.8:5432/db");
      expect(result.allowed).toBe(true);
    });

    it("resolves a hostname via DNS and rejects it if it resolves to a private IP", async () => {
      const dns = await import("node:dns");
      (dns.promises.lookup as ReturnType<typeof vi.fn>).mockResolvedValue([
        { address: "10.0.0.5", family: 4 },
      ]);

      const { assertConnectionStringHostIsAllowed } = await import("../src/sources/host-policy.js");
      const result = await assertConnectionStringHostIsAllowed(
        "postgres://sneaky-internal-looking-name.example.com:5432/db",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/resolves to an internal\/private IP/i);
      expect(dns.promises.lookup).toHaveBeenCalledWith(
        "sneaky-internal-looking-name.example.com",
        { all: true },
      );
    });

    it("resolves a hostname via DNS and allows it if all resolved IPs are public", async () => {
      const dns = await import("node:dns");
      (dns.promises.lookup as ReturnType<typeof vi.fn>).mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
      ]);

      const { assertConnectionStringHostIsAllowed } = await import("../src/sources/host-policy.js");
      const result = await assertConnectionStringHostIsAllowed(
        "postgres://public-db.example.com:5432/db",
      );

      expect(result.allowed).toBe(true);
    });

    it("rejects when DNS resolution fails", async () => {
      const dns = await import("node:dns");
      (dns.promises.lookup as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ENOTFOUND"),
      );

      const { assertConnectionStringHostIsAllowed } = await import("../src/sources/host-policy.js");
      const result = await assertConnectionStringHostIsAllowed(
        "postgres://does-not-resolve.example.com:5432/db",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Could not resolve host/i);
    });

    it("allows an otherwise-private host when it exactly matches the ALLOWED_INTERNAL_DB_HOSTS allowlist", async () => {
      process.env.ALLOWED_INTERNAL_DB_HOSTS = "docker-postgres,other-host";
      const dns = await import("node:dns");

      const { assertConnectionStringHostIsAllowed } = await import("../src/sources/host-policy.js");
      const result = await assertConnectionStringHostIsAllowed(
        "postgres://docker-postgres:5432/db",
      );

      expect(result.allowed).toBe(true);
      // Allowlisted hosts skip resolution entirely.
      expect(dns.promises.lookup).not.toHaveBeenCalled();
    });

    it("does not allowlist a host that isn't an exact match", async () => {
      process.env.ALLOWED_INTERNAL_DB_HOSTS = "docker-postgres";
      const dns = await import("node:dns");
      (dns.promises.lookup as ReturnType<typeof vi.fn>).mockResolvedValue([
        { address: "127.0.0.1", family: 4 },
      ]);

      const { assertConnectionStringHostIsAllowed } = await import("../src/sources/host-policy.js");
      const result = await assertConnectionStringHostIsAllowed(
        "postgres://other-internal-host:5432/db",
      );

      expect(result.allowed).toBe(false);
    });

    it("rejects a multi-host mongodb replica-set URI when any listed host is private", async () => {
      const { assertConnectionStringHostIsAllowed } = await import("../src/sources/host-policy.js");
      const result = await assertConnectionStringHostIsAllowed(
        "mongodb://8.8.8.8:27017,10.0.0.5:27017,93.184.216.34:27017/mydb",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/internal\/private host/i);
    });

    it("allows a multi-host mongodb replica-set URI when every listed host is public", async () => {
      const { assertConnectionStringHostIsAllowed } = await import("../src/sources/host-policy.js");
      const result = await assertConnectionStringHostIsAllowed(
        "mongodb://8.8.8.8:27017,93.184.216.34:27017/mydb",
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe("extractHostnames", () => {
    it("extracts every host from a comma-separated mongodb replica-set authority", async () => {
      const { extractHostnames } = await import("../src/sources/host-policy.js");
      expect(
        extractHostnames("mongodb://user:pass@a.example.com:27017,b.example.com:27018,10.0.0.5:27019/mydb"),
      ).toEqual(["a.example.com", "b.example.com", "10.0.0.5"]);
    });

    it("returns a single-element array for a single-host connection string", async () => {
      const { extractHostnames } = await import("../src/sources/host-policy.js");
      expect(extractHostnames("postgres://user:pass@db.example.com:5432/mydb")).toEqual([
        "db.example.com",
      ]);
    });
  });
});
