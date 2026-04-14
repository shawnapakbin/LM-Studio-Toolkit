import path from "node:path";
import {
  canDelete,
  getWorkspaceRoot,
  isAllowedExtensionForWrite,
  isBlockedPath,
  validateContentSafety,
  validateFileSize,
  validatePath,
} from "../src/policy";

describe("FileEditor policy", () => {
  test("blocks path traversal and allows in-workspace paths", () => {
    const workspace = path.resolve("workspace-root");

    expect(validatePath("src/file.ts", workspace).valid).toBe(true);
    expect(validatePath("../outside.txt", workspace).valid).toBe(false);
  });

  test("blocks sensitive paths", () => {
    expect(isBlockedPath("C:/Windows/System32/drivers/etc/hosts").blocked).toBe(true);
    expect(isBlockedPath("src/index.ts").blocked).toBe(false);
  });

  test("prevents writes to binary extensions", () => {
    expect(isAllowedExtensionForWrite("tools/installer.exe").allowed).toBe(false);
    expect(isAllowedExtensionForWrite("src/app.ts").allowed).toBe(true);
  });

  test("applies file-size and content safety checks", () => {
    expect(validateFileSize(11 * 1024 * 1024).valid).toBe(false);
    expect(validateFileSize(1024).valid).toBe(true);

    expect(validateContentSafety("safe text").safe).toBe(true);
    expect(validateContentSafety("rm -rf /").safe).toBe(false);
  });

  test("protects critical files from deletion", () => {
    expect(canDelete("package.json").allowed).toBe(false);
    expect(canDelete("src/temp.txt").allowed).toBe(true);
  });

  test("returns absolute workspace root", () => {
    const prior = process.env.FILE_EDITOR_WORKSPACE_ROOT;
    process.env.FILE_EDITOR_WORKSPACE_ROOT = ".";

    expect(path.isAbsolute(getWorkspaceRoot())).toBe(true);

    if (prior === undefined) {
      delete process.env.FILE_EDITOR_WORKSPACE_ROOT;
    } else {
      process.env.FILE_EDITOR_WORKSPACE_ROOT = prior;
    }
  });
});
