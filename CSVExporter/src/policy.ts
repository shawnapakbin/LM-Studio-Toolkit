/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import os from "os";
import path from "path";

export const MAX_FILENAME_LENGTH = 120;

export function getDocumentsDirectory(): string {
  if (process.env.CSV_EXPORT_ROOT?.trim()) {
    return path.resolve(process.env.CSV_EXPORT_ROOT.trim());
  }

  const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir();

  return path.resolve(homeDir, "Documents");
}

export function normalizeCsvFilename(filename?: string): string {
  const base = (filename || "parsed-data").trim();
  const stripped = base
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  const safe = stripped.length > 0 ? stripped : "parsed-data";
  const trimmed = safe.slice(0, MAX_FILENAME_LENGTH);
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}

export function validateSubfolder(
  subfolder?: string,
): { valid: true } | { valid: false; error: string } {
  if (!subfolder || !subfolder.trim()) {
    return { valid: true };
  }

  const normalized = path.normalize(subfolder.trim());

  if (path.isAbsolute(normalized)) {
    return { valid: false, error: "subfolder must be relative to Documents." };
  }

  const segments = normalized.split(path.sep);
  if (segments.includes("..")) {
    return { valid: false, error: "subfolder cannot contain parent directory traversal." };
  }

  return { valid: true };
}

export function resolveCsvOutputPath(
  filename?: string,
  subfolder?: string,
):
  | {
      ok: true;
      documentsRoot: string;
      outputPath: string;
    }
  | {
      ok: false;
      error: string;
    } {
  const subfolderCheck = validateSubfolder(subfolder);
  if (!subfolderCheck.valid) {
    return { ok: false, error: subfolderCheck.error };
  }

  const documentsRoot = getDocumentsDirectory();
  const normalizedFile = normalizeCsvFilename(filename);

  const baseDir = subfolder?.trim() ? path.resolve(documentsRoot, subfolder.trim()) : documentsRoot;

  const relative = path.relative(documentsRoot, baseDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, error: "output folder must stay within Documents." };
  }

  const outputPath = path.resolve(baseDir, normalizedFile);
  const outputRelative = path.relative(documentsRoot, outputPath);
  if (outputRelative.startsWith("..") || path.isAbsolute(outputRelative)) {
    return { ok: false, error: "output file must stay within Documents." };
  }

  if (!outputPath.toLowerCase().endsWith(".csv")) {
    return { ok: false, error: "output file must use .csv extension." };
  }

  return {
    ok: true,
    documentsRoot,
    outputPath,
  };
}
