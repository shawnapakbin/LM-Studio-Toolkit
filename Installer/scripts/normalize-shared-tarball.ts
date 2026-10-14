/**
 * Normalize the `package.json` inside a packed workspace-internal tarball so its
 * NESTED workspace-internal dependency specifiers resolve to the sibling
 * TOP-LEVEL `file:` tarballs at install time.
 *
 * Bugfix: mcp-shared-module-resolution-fix — follow-up 5.4.4, task 8.3
 * (design → Follow-up → Fix → Changes Required, option b).
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.2, 6.3.
 *
 * WHY THIS EXISTS
 * ---------------
 * `npm pack <packageDir>` copies the package's `package.json` verbatim into the
 * produced `.tgz`. The five `llm-toolkit-*` packages each carry nested
 * WORKSPACE-INTERNAL specifiers in that manifest:
 *
 *   - `"@shared/types": "file:../shared"`      (all five)
 *   - `"llm-toolkit-observability": "*"`        (calculator, clock)
 *
 * At install time (`npm install --omit=dev` in `install_dir`) npm extracts each
 * tarball and tries to resolve those nested specifiers. `file:../shared` is a
 * RELATIVE path from the extracted tarball location, which does not exist in the
 * install layout — producing a damaged/invalid lockfile and the install error
 * `Cannot destructure property 'package' of 'node.target' as it is null`.
 *
 * THE FIX (option b)
 * ------------------
 * The pack step emits a NORMALIZED `package.json` into each tarball that
 * rewrites every nested specifier whose NAME is one of the closure packages
 * (`@shared/types`, `@shared/config`, the five `llm-toolkit-*`) OR whose
 * specifier is workspace-internal (`file:…`, `"*"`, `workspace:…`, empty) to the
 * bare `"*"` wildcard. npm's TOP-LEVEL `file:` precedence then binds each
 * rewritten `"*"` to the sibling top-level `file:` tarball the flat manifest
 * declares — so there is never a second copy of any package. Registry
 * specifiers (`yaml`, `zod`, `@modelcontextprotocol/sdk`, `mathjs`, …) are left
 * UNCHANGED.
 *
 * The rewrite is driven by the closure NAME SET supplied by the caller (derived
 * from `SHARED_FILE_TARBALL_PACKAGES` / `SHARED_TARBALL_SPECS`), never hardcoded
 * per package.
 *
 * IMPLEMENTATION
 * --------------
 * We rewrite the produced `.tgz` IN PLACE rather than copying the whole package
 * directory before packing: that keeps the real `dist/` and every other shipped
 * file byte-identical (exactly what `npm pack` chose to ship) and only touches
 * the single `package/package.json` entry. The tarball is a gzip-wrapped ustar
 * archive; we gunzip it, walk its 512-byte header/data blocks, replace the
 * bytes of the `package/package.json` entry with the normalized JSON (fixing the
 * header size + checksum and the 512-byte data padding), leave every other
 * entry untouched, and re-gzip. Only Node built-ins (`zlib`) are used, so there
 * is no dependency on a resolvable `tar` module or a system `tar` binary.
 */

import { gunzipSync, gzipSync } from "node:zlib";

/** The npm-pack entry path of the manifest inside every produced tarball. */
const PACKAGE_JSON_ENTRY = "package/package.json";

/** Size of a single tar (ustar) block. */
const BLOCK_SIZE = 512;

/**
 * True iff a dependency specifier refers to a workspace-internal package that
 * cannot resolve from the public registry: `file:` links, the bare `*`
 * wildcard, the npm `workspace:` protocol, or an empty spec. Mirrors
 * `isWorkspaceInternalSpecifier` in `generate-production-manifest.ts` (kept
 * local so this module has no cross-import that would risk a cycle).
 */
function isWorkspaceInternalSpecifier(spec: string): boolean {
  const s = spec.trim();
  return s === "*" || s.startsWith("file:") || s.startsWith("workspace:") || s === "";
}

/**
 * Rewrite the dependency maps of a tarball `package.json` so every NESTED
 * workspace-internal dependency binds to the sibling top-level `file:` tarball.
 *
 * For each entry across `dependencies`, `optionalDependencies`, and
 * `peerDependencies`: if the dependency NAME is in `closureNames` OR its
 * specifier {@link isWorkspaceInternalSpecifier}, the specifier is rewritten to
 * `"*"`. Every other (registry) specifier is left exactly as-is.
 *
 * Pure string→string: parses the manifest, rewrites in place, and re-serializes
 * with a trailing newline (matching how editors/npm write manifests). Returns
 * the ORIGINAL text unchanged when nothing needed rewriting, so a package with
 * only registry deps re-serializes to a byte-identical manifest.
 *
 * @param pkgJsonText the raw `package.json` text from the tarball
 * @param closureNames the set of workspace-internal closure package names
 * @returns the normalized `package.json` text
 */
export function rewritePackageJsonDependencies(
  pkgJsonText: string,
  closureNames: ReadonlySet<string>,
): string {
  const parsed = JSON.parse(pkgJsonText) as Record<string, unknown>;
  let changed = false;

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = parsed[field];
    if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
      continue;
    }
    if (rewriteDepMap(deps as Record<string, string>, closureNames)) {
      changed = true;
    }
  }

  if (!changed) {
    return pkgJsonText;
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * Rewrite a single dependency map in place: every entry whose NAME is in
 * `closureNames` or whose specifier is workspace-internal is set to `"*"`.
 * Returns true iff at least one specifier changed.
 */
function rewriteDepMap(map: Record<string, string>, closureNames: ReadonlySet<string>): boolean {
  let changed = false;
  for (const [name, spec] of Object.entries(map)) {
    if (typeof spec !== "string" || spec === "*") {
      continue;
    }
    if (closureNames.has(name) || isWorkspaceInternalSpecifier(spec)) {
      map[name] = "*";
      changed = true;
    }
  }
  return changed;
}

/** Parse an octal numeric tar header field (space/NUL-terminated). */
function parseOctal(buf: Buffer, offset: number, length: number): number {
  const raw = buf
    .toString("ascii", offset, offset + length)
    .replaceAll("\0", "")
    .trim();
  return raw.length === 0 ? 0 : Number.parseInt(raw, 8);
}

/** Write an octal numeric tar header field: zero-padded, NUL-terminated. */
function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
  // Field is `length` bytes: (length-1) octal digits + a trailing NUL.
  const digits = value.toString(8).padStart(length - 1, "0");
  buf.write(digits, offset, length - 1, "ascii");
  buf[offset + length - 1] = 0;
}

/**
 * Recompute and write the ustar header checksum for a 512-byte header block.
 * The checksum is the unsigned sum of all header bytes with the 8-byte checksum
 * field treated as ASCII spaces, written as a 6-digit octal + NUL + space.
 */
function fixHeaderChecksum(header: Buffer): void {
  // Treat the checksum field (offset 148, len 8) as spaces while summing.
  for (let i = 148; i < 156; i++) {
    header[i] = 0x20;
  }
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    sum += header[i];
  }
  const octal = sum.toString(8).padStart(6, "0");
  header.write(octal, 148, 6, "ascii");
  header[154] = 0; // NUL
  header[155] = 0x20; // space
}

/** Round a byte length up to the next 512-byte tar block boundary. */
function roundUpToBlock(size: number): number {
  return Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
}

/** Truncate a fixed-width tar string field at its first NUL terminator. */
function stripFromNul(field: string): string {
  const nul = field.indexOf("\0");
  return nul === -1 ? field : field.slice(0, nul);
}

/**
 * Rewrite the `package/package.json` entry inside a gunzipped tar buffer,
 * returning a new tar buffer with every other entry byte-identical.
 *
 * Walks the archive block by block. For the manifest entry we replace the data
 * payload with the normalized JSON, update the header's size field + checksum,
 * and re-pad the data to a 512-byte boundary. Non-matching entries (headers +
 * data + padding) are copied through verbatim, and the trailing zero blocks are
 * preserved.
 */
function rewriteTarBuffer(tar: Buffer, closureNames: ReadonlySet<string>): Buffer {
  const out: Buffer[] = [];
  let offset = 0;
  let rewroteManifest = false;

  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);

    // A full zero block signals the end-of-archive marker; copy the remainder
    // (the two trailing zero blocks + any gzip padding) through unchanged.
    if (header.every((b) => b === 0)) {
      out.push(tar.subarray(offset));
      break;
    }

    // Entry name: ustar stores a `prefix` (offset 345, len 155) joined to the
    // `name` (offset 0, len 100) with `/`. npm's entries fit in `name`, but we
    // honor the prefix for correctness.
    const name = stripFromNul(header.toString("ascii", 0, 100));
    const prefix = stripFromNul(header.toString("ascii", 345, 500));
    const fullName = prefix.length > 0 ? `${prefix}/${name}` : name;

    const size = parseOctal(header, 124, 12);
    const dataStart = offset + BLOCK_SIZE;
    const paddedSize = roundUpToBlock(size);

    if (fullName === PACKAGE_JSON_ENTRY) {
      const originalText = tar.toString("utf8", dataStart, dataStart + size);
      const normalizedText = rewritePackageJsonDependencies(originalText, closureNames);
      const normalized = Buffer.from(normalizedText, "utf8");

      // Clone + patch the header (new size + checksum), then emit padded data.
      const newHeader = Buffer.from(header);
      writeOctal(newHeader, 124, 12, normalized.length);
      fixHeaderChecksum(newHeader);

      const padded = Buffer.alloc(roundUpToBlock(normalized.length));
      normalized.copy(padded, 0);

      out.push(newHeader, padded);
      rewroteManifest = true;
    } else {
      // Copy the header + data (+ padding) verbatim.
      out.push(tar.subarray(offset, dataStart + paddedSize));
    }

    offset = dataStart + paddedSize;
  }

  if (!rewroteManifest) {
    throw new Error(
      `[normalize-shared-tarball] no "${PACKAGE_JSON_ENTRY}" entry found in the tarball; cannot normalize nested specifiers`,
    );
  }

  return Buffer.concat(out);
}

/**
 * Normalize a packed workspace-internal `.tgz` IN PLACE: rewrite its
 * `package/package.json` so nested workspace-internal specifiers bind to the
 * sibling top-level `file:` tarballs (see the module header), leaving `dist/`
 * and every other shipped file byte-identical.
 *
 * No-op-safe: a tarball whose manifest has only registry specifiers is rewritten
 * to a byte-identical manifest, so re-gzipping is harmless.
 *
 * @param readFile reads the tarball bytes (injected for testability)
 * @param writeFile writes the tarball bytes (injected for testability)
 * @param tgzPath absolute path to the produced `.tgz`
 * @param closureNames the set of workspace-internal closure package names
 */
export function normalizeSharedTarball(
  readFile: (p: string) => Buffer,
  writeFile: (p: string, data: Buffer) => void,
  tgzPath: string,
  closureNames: ReadonlySet<string>,
): void {
  const gz = readFile(tgzPath);
  const tar = gunzipSync(gz);
  const rewritten = rewriteTarBuffer(tar, closureNames);
  // Re-gzip deterministically. The exact compression ratio is irrelevant; npm
  // reads the inflated contents.
  const regz = gzipSync(rewritten);
  writeFile(tgzPath, regz);
}
