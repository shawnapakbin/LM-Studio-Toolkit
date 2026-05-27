import fsSync from "fs";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { MAX_FILE_SIZE } from "./policy";

export type ReadFileInput = z.infer<typeof ReadFileSchema>;
export type WriteFileInput = z.infer<typeof WriteFileSchema>;
export type SearchFilesInput = z.infer<typeof SearchFilesSchema>;
export type ListDirectoryInput = z.infer<typeof ListDirectorySchema>;
export type DeleteFileInput = z.infer<typeof DeleteFileSchema>;
export type MoveFileInput = z.infer<typeof MoveFileSchema>;

export const ReadFileSchema = z.object({
  path: z.string().min(1, "file path required"),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

const approvalDesc =
  "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.";

export const WriteFileSchema = z.object({
  path: z.string().min(1, "file path required"),
  content: z.string(),
  createBackup: z.boolean().optional().default(false),
  mode: z.enum(["overwrite", "append"]).optional().default("overwrite"),
  approvalToken: z.string().optional().describe(approvalDesc),
  approvalInterviewId: z
    .string()
    .optional()
    .describe("AskUser interview ID used to verify explicit approval."),
  sessionId: z
    .string()
    .optional()
    .describe("Session identifier for session-scoped approval grants."),
  taskRunId: z
    .string()
    .optional()
    .describe("Task run identifier (alternative to sessionId) for session-scoped approval grants."),
});

export const SearchFilesSchema = z.object({
  pattern: z.string().min(1, "search pattern required"),
  directory: z.string().optional(),
  fileExtensions: z.array(z.string()).optional(),
  maxResults: z.number().int().positive().optional().default(50),
  caseSensitive: z.boolean().optional().default(false),
});

export const ListDirectorySchema = z.object({
  path: z.string().min(1, "directory path required"),
  recursive: z.boolean().optional().default(false),
  includeHidden: z.boolean().optional().default(false),
});

export const DeleteFileSchema = z.object({
  path: z.string().min(1, "file path required"),
  createBackup: z.boolean().optional().default(true),
  approvalToken: z.string().optional().describe(approvalDesc),
  approvalInterviewId: z
    .string()
    .optional()
    .describe("AskUser interview ID used to verify explicit approval."),
  sessionId: z
    .string()
    .optional()
    .describe("Session identifier for session-scoped approval grants."),
  taskRunId: z
    .string()
    .optional()
    .describe("Task run identifier (alternative to sessionId) for session-scoped approval grants."),
});

export const MoveFileSchema = z.object({
  source: z.string().min(1, "source path required"),
  destination: z.string().min(1, "destination path required"),
  overwrite: z.boolean().optional().default(false),
  approvalToken: z.string().optional().describe(approvalDesc),
  approvalInterviewId: z
    .string()
    .optional()
    .describe("AskUser interview ID used to verify explicit approval."),
  sessionId: z
    .string()
    .optional()
    .describe("Session identifier for session-scoped approval grants."),
  taskRunId: z
    .string()
    .optional()
    .describe("Task run identifier (alternative to sessionId) for session-scoped approval grants."),
});

export type FileInfo = {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  created: string;
  modified: string;
  extension?: string;
};

export type SearchResult = {
  file: string;
  line: number;
  column: number;
  text: string;
  context?: {
    before: string[];
    after: string[];
  };
};

const BACKUP_DIR = ".file-editor-backups";

/**
 * Read file contents with optional line range
 */
export async function readFile(
  input: ReadFileInput,
  workspaceRoot: string,
): Promise<{ content: string; lines: number }> {
  const absolutePath = path.resolve(workspaceRoot, input.path);

  // Check file exists
  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${input.path}`);
  }

  // Check file size
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})`);
  }

  // Read file
  const content = await fs.readFile(absolutePath, "utf-8");
  const lines = content.split("\n");

  // Apply line range if specified
  if (input.startLine !== undefined || input.endLine !== undefined) {
    const start = (input.startLine ?? 1) - 1; // Convert to 0-indexed
    const end = input.endLine ?? lines.length;

    if (start < 0 || start >= lines.length) {
      throw new Error(`Start line ${input.startLine} out of range (1-${lines.length})`);
    }
    if (end > lines.length) {
      throw new Error(`End line ${input.endLine} out of range (1-${lines.length})`);
    }
    if (start >= end) {
      throw new Error(`Start line must be less than end line`);
    }

    const selectedLines = lines.slice(start, end);
    return {
      content: selectedLines.join("\n"),
      lines: selectedLines.length,
    };
  }

  return {
    content,
    lines: lines.length,
  };
}

/**
 * Write content to file with optional backup
 */
export async function writeFile(
  input: WriteFileInput,
  workspaceRoot: string,
): Promise<{ bytesWritten: number; backup?: string }> {
  const absolutePath = path.resolve(workspaceRoot, input.path);
  const dir = path.dirname(absolutePath);

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  let backupPath: string | undefined;

  // Create backup if file exists and backup requested
  if (input.createBackup && fsSync.existsSync(absolutePath)) {
    const backupDir = path.join(workspaceRoot, BACKUP_DIR);
    await fs.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const basename = path.basename(absolutePath);
    backupPath = path.join(backupDir, `${basename}.${timestamp}.backup`);

    await fs.copyFile(absolutePath, backupPath);
  }

  // Write file
  let finalContent = input.content;
  if (input.mode === "append" && fsSync.existsSync(absolutePath)) {
    const existing = await fs.readFile(absolutePath, "utf-8");
    finalContent = existing + input.content;
  }

  await fs.writeFile(absolutePath, finalContent, "utf-8");
  const stats = await fs.stat(absolutePath);

  return {
    bytesWritten: stats.size,
    backup: backupPath,
  };
}

/**
 * Search for pattern in files
 */
export async function searchFiles(
  input: SearchFilesInput,
  workspaceRoot: string,
): Promise<SearchResult[]> {
  const searchDir = input.directory ? path.resolve(workspaceRoot, input.directory) : workspaceRoot;
  const results: SearchResult[] = [];
  const pattern = input.caseSensitive ? input.pattern : input.pattern.toLowerCase();

  async function searchInDirectory(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        await searchInDirectory(fullPath);
      } else if (entry.isFile()) {
        // Filter by extension if specified
        if (input.fileExtensions && input.fileExtensions.length > 0) {
          const ext = path.extname(entry.name);
          if (!input.fileExtensions.includes(ext)) continue;
        }

        // Search in file
        const relativePath = path.relative(workspaceRoot, fullPath);
        await searchInFile(fullPath, relativePath, pattern, input.caseSensitive ?? false);

        if (results.length >= input.maxResults) return;
      }
    }
  }

  async function searchInFile(
    filePath: string,
    relativePath: string,
    searchPattern: string,
    caseSensitive: boolean,
  ): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_FILE_SIZE) return; // Skip large files

      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const searchLine = caseSensitive ? line : line.toLowerCase();
        const index = searchLine.indexOf(searchPattern);

        if (index !== -1) {
          results.push({
            file: relativePath,
            line: i + 1, // 1-indexed
            column: index + 1, // 1-indexed
            text: line.trim(),
            context: {
              before: lines.slice(Math.max(0, i - 2), i).map((l) => l.trim()),
              after: lines.slice(i + 1, Math.min(lines.length, i + 3)).map((l) => l.trim()),
            },
          });

          if (results.length >= input.maxResults) return;
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  await searchInDirectory(searchDir);
  return results;
}

/**
 * List directory contents
 */
export async function listDirectory(
  input: ListDirectoryInput,
  workspaceRoot: string,
): Promise<FileInfo[]> {
  const absolutePath = path.resolve(workspaceRoot, input.path);
  const stats = await fs.stat(absolutePath);

  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${input.path}`);
  }

  const results: FileInfo[] = [];

  async function listRecursive(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files/directories unless includeHidden is true
      if (!input.includeHidden && entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);
      const stats = await fs.stat(fullPath);
      const relativePath = path.relative(workspaceRoot, fullPath);

      results.push({
        path: relativePath,
        name: entry.name,
        size: stats.size,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        extension: entry.isFile() ? path.extname(entry.name) : undefined,
      });

      if (input.recursive && entry.isDirectory()) {
        await listRecursive(fullPath);
      }
    }
  }

  await listRecursive(absolutePath);
  return results;
}

/**
 * Delete file with optional backup
 */
export async function deleteFile(
  input: DeleteFileInput,
  workspaceRoot: string,
): Promise<{ deleted: boolean; backup?: string }> {
  const absolutePath = path.resolve(workspaceRoot, input.path);

  // Check file exists
  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${input.path}`);
  }

  let backupPath: string | undefined;

  // Create backup if requested
  if (input.createBackup) {
    const backupDir = path.join(workspaceRoot, BACKUP_DIR);
    await fs.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const basename = path.basename(absolutePath);
    backupPath = path.join(backupDir, `${basename}.${timestamp}.backup`);

    await fs.copyFile(absolutePath, backupPath);
  }

  // Delete file
  await fs.unlink(absolutePath);

  return {
    deleted: true,
    backup: backupPath,
  };
}

/**
 * Move/rename file
 */
export async function moveFile(
  input: MoveFileInput,
  workspaceRoot: string,
): Promise<{ moved: boolean }> {
  const sourcePath = path.resolve(workspaceRoot, input.source);
  const destPath = path.resolve(workspaceRoot, input.destination);

  // Check source exists
  await fs.stat(sourcePath);

  // Check if destination exists
  if (fsSync.existsSync(destPath) && !input.overwrite) {
    throw new Error(`Destination already exists: ${input.destination}`);
  }

  // Ensure destination directory exists
  const destDir = path.dirname(destPath);
  await fs.mkdir(destDir, { recursive: true });

  // Move file
  await fs.rename(sourcePath, destPath);

  return {
    moved: true,
  };
}
