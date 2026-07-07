/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import path from "path";
import fs from "fs/promises";
import { resolveCsvOutputPath } from "./policy";

export type ExportCsvInput = {
  filename?: string;
  subfolder?: string;
  headers: string[];
  rows: unknown[][];
  append?: boolean;
};

export type ExportCsvResult = {
  success: boolean;
  outputPath?: string;
  documentsRoot?: string;
  rowsWritten?: number;
  appended?: boolean;
  createdNewFile?: boolean;
  error?: string;
};

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);

  const needsQuotes = /[",\n\r]/.test(text);
  const escaped = text.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function toCsvLine(values: unknown[]): string {
  return values.map((value) => escapeCsvValue(value)).join(",");
}

function validateTable(
  headers: string[],
  rows: unknown[][],
): { valid: true } | { valid: false; error: string } {
  if (!Array.isArray(headers) || headers.length === 0) {
    return { valid: false, error: "headers must contain at least one column." };
  }

  const hasEmptyHeader = headers.some((h) => typeof h !== "string" || h.trim().length === 0);
  if (hasEmptyHeader) {
    return { valid: false, error: "headers cannot contain empty column names." };
  }

  if (!Array.isArray(rows)) {
    return { valid: false, error: "rows must be an array of arrays." };
  }

  for (let i = 0; i < rows.length; i++) {
    if (!Array.isArray(rows[i])) {
      return { valid: false, error: `row ${i} is not an array.` };
    }

    if (rows[i].length !== headers.length) {
      return {
        valid: false,
        error: `row ${i} has ${rows[i].length} columns; expected ${headers.length}.`,
      };
    }
  }

  return { valid: true };
}

export async function exportParsedDataToCsv(input: ExportCsvInput): Promise<ExportCsvResult> {
  const tableValidation = validateTable(input.headers, input.rows);
  if (!tableValidation.valid) {
    return { success: false, error: tableValidation.error };
  }

  const pathResolution = resolveCsvOutputPath(input.filename, input.subfolder);
  if (!pathResolution.ok) {
    return { success: false, error: pathResolution.error };
  }

  const { outputPath, documentsRoot } = pathResolution;
  const append = input.append ?? true;

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const headerLine = toCsvLine(input.headers);
    const rowLines = input.rows.map((row) => toCsvLine(row));
    const body = rowLines.join("\r\n");

    let fileExists = true;
    let fileSize = 0;
    try {
      const stat = await fs.stat(outputPath);
      fileSize = stat.size;
    } catch {
      fileExists = false;
    }

    const writeBody = body.length > 0 ? body : "";

    if (append && fileExists) {
      const prefix = fileSize > 0 ? "\r\n" : "";
      const contentToAppend =
        fileSize > 0
          ? `${prefix}${writeBody}`
          : `${headerLine}${writeBody ? `\r\n${writeBody}` : ""}`;

      if (contentToAppend.length > 0) {
        await fs.appendFile(outputPath, contentToAppend, "utf8");
      }

      return {
        success: true,
        outputPath,
        documentsRoot,
        rowsWritten: input.rows.length,
        appended: true,
        createdNewFile: false,
      };
    }

    const fullContent = `${headerLine}${writeBody ? `\r\n${writeBody}` : ""}`;
    await fs.writeFile(outputPath, fullContent, "utf8");

    return {
      success: true,
      outputPath,
      documentsRoot,
      rowsWritten: input.rows.length,
      appended: false,
      createdNewFile: !fileExists,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: `CSV export failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
