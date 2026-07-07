/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { exportParsedDataToCsv } from "./csv-exporter";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT ?? 3339);

type ExportRequest = {
  filename?: string;
  subfolder?: string;
  headers?: string[];
  rows?: unknown[][];
  append?: boolean;
};

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-csv-exporter-tool" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "save_parsed_data_csv",
    description: "Saves parsed tabular data as CSV in Documents.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Output filename. .csv added when omitted." },
        subfolder: { type: "string", description: "Optional subfolder under Documents." },
        headers: { type: "array", items: { type: "string" } },
        rows: {
          type: "array",
          items: {
            type: "array",
            items: {},
          },
        },
        append: { type: "boolean", description: "Append rows to existing CSV. Defaults to true." },
      },
      required: ["headers", "rows"],
    },
  });
});

app.post(
  "/tools/save_parsed_data_csv",
  async (req: Request<unknown, unknown, ExportRequest>, res: Response) => {
    const { filename, subfolder, headers, rows, append } = req.body || {};

    if (!Array.isArray(headers) || !Array.isArray(rows)) {
      res.status(400).json({
        success: false,
        error: "headers and rows are required arrays.",
      });
      return;
    }

    const result = await exportParsedDataToCsv({ filename, subfolder, headers, rows, append });
    res.status(result.success ? 200 : 400).json(result);
  },
);

export { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio CSV Exporter Tool listening on http://localhost:${PORT}`);
  });
}
