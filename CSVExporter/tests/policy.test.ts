/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import os from "os";
import path from "path";
import {
  getDocumentsDirectory,
  normalizeCsvFilename,
  resolveCsvOutputPath,
  validateSubfolder,
} from "../src/policy";

describe("CSV Exporter policy", () => {
  const originalExportRoot = process.env.CSV_EXPORT_ROOT;

  afterEach(() => {
    if (originalExportRoot === undefined) {
      delete process.env.CSV_EXPORT_ROOT;
    } else {
      process.env.CSV_EXPORT_ROOT = originalExportRoot;
    }
  });

  it("uses CSV_EXPORT_ROOT when configured", () => {
    process.env.CSV_EXPORT_ROOT = path.join(os.tmpdir(), "csv-export-policy-root");
    expect(getDocumentsDirectory()).toBe(path.resolve(process.env.CSV_EXPORT_ROOT));
  });

  it("normalizes and enforces csv extension", () => {
    expect(normalizeCsvFilename("Quarterly Report")).toBe("Quarterly-Report.csv");
    expect(normalizeCsvFilename("already.csv")).toBe("already.csv");
  });

  it("rejects absolute subfolder", () => {
    const result = validateSubfolder(path.resolve("outside"));
    expect(result.valid).toBe(false);
  });

  it("rejects traversal subfolder", () => {
    const result = validateSubfolder("../outside");
    expect(result.valid).toBe(false);
  });

  it("resolves path under configured Documents root", () => {
    process.env.CSV_EXPORT_ROOT = path.join(os.tmpdir(), "csv-export-policy-safe");
    const resolved = resolveCsvOutputPath("report", "project-a");

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.outputPath.endsWith("report.csv")).toBe(true);
      expect(resolved.outputPath.startsWith(path.resolve(process.env.CSV_EXPORT_ROOT))).toBe(true);
    }
  });
});
