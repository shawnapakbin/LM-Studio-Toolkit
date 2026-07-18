// Feature: 3dtool-viewer-improvements, Property 1: Format Detection Routing
// **Validates: Requirements 2.1, 2.4, 2.5**

import * as fc from "fast-check";
import { type SupportedFormat, detectFormat } from "../../src/types";

/**
 * Property 1: Format Detection Routing
 *
 * For any file path string, detectFormat SHALL return a valid SupportedFormat
 * ('obj' | 'glb' | 'gltf') if and only if the extension matches one of those
 * formats, and SHALL return null for any other extension.
 */

const SUPPORTED_EXTENSIONS: Record<string, SupportedFormat> = {
  ".obj": "obj",
  ".glb": "glb",
  ".gltf": "gltf",
};

// Arbitrary for generating file path base names (directories + filename without extension)
const filePathBase = fc.oneof(
  // Simple filenames
  fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_".split("")), {
    minLength: 1,
    maxLength: 20,
  }),
  // Paths with directories
  fc
    .tuple(
      fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
        minLength: 1,
        maxLength: 10,
      }),
      fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
        minLength: 1,
        maxLength: 10,
      }),
      fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
        minLength: 1,
        maxLength: 10,
      }),
    )
    .map(([dir1, dir2, file]) => `${dir1}/${dir2}/${file}`),
  // Absolute paths (Windows-style)
  fc
    .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
      minLength: 1,
      maxLength: 10,
    })
    .map((name) => `C:\\Users\\test\\${name}`),
  // Absolute paths (Unix-style)
  fc
    .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
      minLength: 1,
      maxLength: 10,
    })
    .map((name) => `./models/${name}`),
);

// Arbitrary for supported extensions with varied casing
const supportedExtension = fc.constantFrom(
  ".obj",
  ".glb",
  ".gltf",
  ".OBJ",
  ".GLB",
  ".GLTF",
  ".Obj",
  ".Glb",
  ".Gltf",
  ".OBj",
  ".gLb",
  ".gLTF",
);

// Arbitrary for unsupported extensions
const unsupportedExtension = fc.oneof(
  fc.constantFrom(
    ".fbx",
    ".stl",
    ".ply",
    ".dae",
    ".3ds",
    ".blend",
    ".max",
    ".abc",
    ".usd",
    ".usda",
    ".usdz",
    ".txt",
    ".json",
    ".png",
    ".jpg",
    ".mp4",
  ),
  // Random extensions that are not supported
  fc
    .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
      minLength: 1,
      maxLength: 5,
    })
    .filter((ext) => !["obj", "glb", "gltf"].includes(ext.toLowerCase()))
    .map((ext) => `.${ext}`),
);

describe("Property 1: Format Detection Routing", () => {
  it("returns the correct SupportedFormat for any file path with a supported extension (case-insensitive)", () => {
    fc.assert(
      fc.property(filePathBase, supportedExtension, (basePath, ext) => {
        const filePath = basePath + ext;
        const result = detectFormat(filePath);
        const expectedFormat = SUPPORTED_EXTENSIONS[ext.toLowerCase()];

        // Must return a valid SupportedFormat
        expect(result).not.toBeNull();
        expect(result).toBe(expectedFormat);
      }),
      { numRuns: 100 },
    );
  });

  it("returns null for any file path with an unsupported extension", () => {
    fc.assert(
      fc.property(filePathBase, unsupportedExtension, (basePath, ext) => {
        const filePath = basePath + ext;
        const result = detectFormat(filePath);

        // Must return null for unsupported formats
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("returns null for file paths with no extension", () => {
    fc.assert(
      fc.property(filePathBase, (basePath) => {
        // Ensure no dot in the last segment to avoid accidental extension
        const cleanPath = basePath.replace(/\.[^/\\]*$/, "");
        const result = detectFormat(cleanPath);

        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("the return value is always either a valid SupportedFormat or null", () => {
    // Generate completely arbitrary strings to test robustness
    const arbitraryFilePath = fc.oneof(
      // Paths with supported extensions
      filePathBase.chain((base) => supportedExtension.map((ext) => base + ext)),
      // Paths with unsupported extensions
      filePathBase.chain((base) => unsupportedExtension.map((ext) => base + ext)),
      // Paths without extensions
      filePathBase,
      // Edge cases
      fc.constantFrom("", ".", "..", "...", "file.", "/", "\\"),
    );

    fc.assert(
      fc.property(arbitraryFilePath, (filePath) => {
        const result = detectFormat(filePath);

        if (result !== null) {
          // If not null, must be one of the valid formats
          expect(["obj", "glb", "gltf"]).toContain(result);
        }
        // null is always acceptable for non-matching paths
      }),
      { numRuns: 100 },
    );
  });
});
