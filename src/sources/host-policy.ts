import dns from "node:dns";
import ipaddr from "ipaddr.js";

import { config } from "../config.js";

/**
 * IP "ranges" (as classified by ipaddr.js) that are considered internal to
 * the server's own network and therefore off-limits for user-supplied DB
 * connection strings in a hosted, multi-tenant deployment. This covers:
 *   - RFC1918 private ranges (10/8, 172.16/12, 192.168/16)
 *   - loopback (127.0.0.0/8, ::1)
 *   - link-local (169.254.0.0/16 - including the 169.254.169.254 cloud
 *     metadata endpoint - and fe80::/10)
 *   - IPv6 unique-local addresses (fc00::/7)
 */
const BLOCKED_IP_RANGES = new Set(["private", "loopback", "linkLocal", "uniqueLocal"]);

/**
 * True if the given IP address string falls into one of the blocked
 * "internal to this server's network" ranges above.
 */
export function isPrivateOrInternalIp(ip: string): boolean {
  let parsed: ReturnType<typeof ipaddr.process>;
  try {
    parsed = ipaddr.process(ip);
  } catch {
    // Not a parseable IP literal - treat as "not a known-private IP" here;
    // callers are expected to have already resolved hostnames to IPs before
    // calling this function.
    return false;
  }
  return BLOCKED_IP_RANGES.has(parsed.range());
}

/**
 * Extracts the hostname portion of a Postgres/MySQL-style connection URI
 * (e.g. "postgres://user:pass@host:5432/db" or "mysql://host/db"). Falls
 * back to a small regex for connection strings that aren't valid URIs (e.g.
 * missing a scheme), since `new URL(...)` throws on those.
 */
export function extractHostname(connectionString: string): string | undefined {
  try {
    // Swap whatever scheme is present for "http:" so the WHATWG URL parser
    // (which only special-cases a fixed set of schemes for host parsing)
    // reliably extracts the host for us.
    const rewritten = connectionString.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, "http:");
    const url = new URL(rewritten);
    return url.hostname || undefined;
  } catch {
    // Fallback regex: scheme://[user[:pass]@]host[:port][/...]
    const match = connectionString.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/]*@)?([^:/?#]+)/);
    return match?.[1];
  }
}

/**
 * Extracts every hostname from a connection string's authority section,
 * handling the comma-separated multi-host form MongoDB replica-set URIs use
 * (e.g. "mongodb://a:27017,b:27017,c:27017/db") - Postgres/MySQL connection
 * strings only ever have one host, so this returns a single-element array
 * for those, identical to extractHostname. Falls back to extractHostname's
 * result when the authority can't be isolated some other way.
 */
export function extractHostnames(connectionString: string): string[] {
  const withoutScheme = connectionString.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const withoutUserinfo = withoutScheme.replace(/^[^@/]*@/, "");
  const authority = withoutUserinfo.split(/[/?#]/)[0] ?? "";

  const hosts = authority
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (segment.startsWith("[")) {
        // Bracketed IPv6, e.g. "[::1]:27017" -> "::1".
        const end = segment.indexOf("]");
        return end > 0 ? segment.slice(1, end) : segment;
      }
      const colonIndex = segment.lastIndexOf(":");
      return colonIndex > 0 ? segment.slice(0, colonIndex) : segment;
    })
    .filter((host) => host.length > 0);

  if (hosts.length > 0) return hosts;

  const fallback = extractHostname(connectionString);
  return fallback ? [fallback] : [];
}

export interface HostPolicyResult {
  allowed: boolean;
  reason?: string;
}

async function checkSingleHost(hostname: string): Promise<HostPolicyResult> {
  if (config.allowedInternalDbHosts.includes(hostname)) {
    return { allowed: true };
  }

  // If the hostname is already an IP literal, ipaddr.js can classify it
  // directly without any DNS lookup.
  if (ipaddr.isValid(hostname)) {
    if (isPrivateOrInternalIp(hostname)) {
      return {
        allowed: false,
        reason: `Connections to internal/private host "${hostname}" are not allowed.`,
      };
    }
    return { allowed: true };
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (error) {
    return {
      allowed: false,
      reason: `Could not resolve host "${hostname}": ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const blockedAddress = addresses.find((address) => isPrivateOrInternalIp(address.address));
  if (blockedAddress) {
    return {
      allowed: false,
      reason: `Host "${hostname}" resolves to an internal/private IP address (${blockedAddress.address}) and is not allowed.`,
    };
  }

  return { allowed: true };
}

/**
 * Validates that a user-supplied Postgres/MySQL/MongoDB connection string
 * does not point at a host that resolves into the server's own internal
 * network (SSRF guard). Must be called BEFORE creating a pg.Pool/mysql
 * pool/MongoClient. For a multi-host MongoDB replica-set URI, every listed
 * host is checked - the connection is rejected if any one of them is
 * internal/private.
 *
 * Residual risk (documented, not fixed here): this performs a
 * lookup-then-reject check. It does not pin the connection to the resolved
 * IP nor re-verify the IP at actual connect time, so it does not fully
 * defend against DNS rebinding (where a hostname resolves to a public IP at
 * validation time but is repointed to an internal IP by the time the driver
 * performs its own internal DNS resolution per connection). A complete fix
 * would require pinning/re-checking at connect time, which is out of scope
 * here. Additionally, for "mongodb+srv://" URIs this only validates the SRV
 * record's own hostname, not the actual replica hosts it resolves to via DNS
 * SRV/TXT records - fully validating those would require performing the SRV
 * resolution ourselves, which is also out of scope here.
 */
export async function assertConnectionStringHostIsAllowed(
  connectionString: string,
): Promise<HostPolicyResult> {
  const hostnames = extractHostnames(connectionString);
  if (hostnames.length === 0) {
    return { allowed: false, reason: "Could not determine the target host from the connection string." };
  }

  for (const hostname of hostnames) {
    const result = await checkSingleHost(hostname);
    if (!result.allowed) return result;
  }

  return { allowed: true };
}
