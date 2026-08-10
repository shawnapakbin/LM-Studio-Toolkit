/**
 * Self-exclusion utilities for the LAN Sub Agent.
 * Resolves all local addresses so the dispatcher can avoid sending tasks
 * back to the same LM Studio instance processing the parent request.
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import * as os from "os";

/**
 * Resolves all addresses that refer to the local machine at the given port.
 * This includes:
 * - localhost:<port>
 * - 127.0.0.1:<port>
 * - ::1:<port>
 * - All non-internal LAN IPs from os.networkInterfaces()
 * - The configured host itself (in case it's a hostname alias)
 *
 * @param configHost - The configured local instance host (e.g. from SUBAGENT_LOCAL_HOST)
 * @param configPort - The configured local instance port (e.g. from SUBAGENT_LOCAL_PORT)
 * @returns A Set of "host:port" strings that all refer to the local machine
 */
export function resolveLocalAddresses(configHost: string, configPort: number): Set<string> {
  const addresses = new Set<string>();

  // Always include standard loopback variants
  addresses.add(`localhost:${configPort}`);
  addresses.add(`127.0.0.1:${configPort}`);
  addresses.add(`::1:${configPort}`);

  // Include the configured host itself (may be a custom hostname)
  const normalizedHost = configHost.toLowerCase();
  addresses.add(`${normalizedHost}:${configPort}`);

  // Include all non-internal network interface addresses (LAN IPs)
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (!addr.internal) {
        addresses.add(`${addr.address}:${configPort}`);
      }
    }
  }

  return addresses;
}

/**
 * Check whether a given host:port combination refers to the local machine.
 *
 * @param host - The endpoint host to check
 * @param port - The endpoint port to check
 * @param localAddresses - Set of local address strings from resolveLocalAddresses()
 * @returns true if the host:port matches any local address
 */
export function isLocalEndpoint(host: string, port: number, localAddresses: Set<string>): boolean {
  const normalized = `${host.toLowerCase()}:${port}`;
  return localAddresses.has(normalized);
}
