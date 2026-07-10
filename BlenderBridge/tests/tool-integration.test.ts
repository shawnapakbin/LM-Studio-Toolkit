/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Integration tests for BlenderBridge orchestration tools.
 *
 * Tests tool handlers with mocked BlenderClient executeCode/callTool methods.
 * Verifies end-to-end behavior of tool creation, input handling, and response formatting.
 */

import { BlenderClient, createBlenderClient } from "../src/blender-client";
import { createCleanupDatablocksTool } from "../src/tools/cleanup-datablocks.tool";
import { createFileIntegrityTool } from "../src/tools/file-integrity.tool";
import { createMeshValidateTool } from "../src/tools/mesh-validate.tool";
import { createPerformanceMetricsTool } from "../src/tools/performance-metrics.tool";
import { createRenderPreviewTool } from "../src/tools/render-preview.tool";
import { BlenderBridgeConfig } from "../src/types";

/** Helper to extract text from the first content item */
function getContentText(
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): string {
  const item = content[0] as { type: "text"; text: string };
  return item.text;
}

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  healthCheckTimeoutMs: 5000,
  operationTimeoutMs: 30000,
  renderTimeoutMs: 90000,
};

function createMockClient(executeCodeFn: (code: string) => Promise<string>): BlenderClient {
  return createBlenderClient(defaultConfig, executeCodeFn);
}

describe("tool-integration tests", () => {
  describe("blender_cleanup_datablocks", () => {
    it("returns successful cleanup result on valid response", async () => {
      const mockOutput = JSON.stringify({
        totalFound: 3,
        totalRemoved: 3,
        removedByType: { meshes: 2, materials: 1 },
        removed: [
          { name: "Mesh.001", type: "meshes" },
          { name: "Mesh.002", type: "meshes" },
          { name: "Material.001", type: "materials" },
        ],
        errors: [],
      });

      const client = createMockClient(async () => mockOutput);
      const tool = createCleanupDatablocksTool(defaultConfig, client);
      const result = await tool.handler({ dryRun: false });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.totalRemoved).toBe(3);
      expect(parsed.removedByType.meshes).toBe(2);
      expect(parsed.removedByType.materials).toBe(1);
    });

    it("returns dryRun result with totalRemoved = 0", async () => {
      const mockOutput = JSON.stringify({
        totalFound: 5,
        totalRemoved: 0,
        removedByType: { meshes: 3, images: 2 },
        removed: [],
      });

      const client = createMockClient(async () => mockOutput);
      const tool = createCleanupDatablocksTool(defaultConfig, client);
      const result = await tool.handler({ dryRun: true });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.totalRemoved).toBe(0);
      expect(parsed.totalFound).toBe(5);
    });

    it("returns error on execution failure", async () => {
      const client = createMockClient(async () => {
        throw new Error("Connection refused");
      });
      const tool = createCleanupDatablocksTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBeDefined();
    });

    it("handles partial failures with errors array", async () => {
      const mockOutput = JSON.stringify({
        totalFound: 3,
        totalRemoved: 2,
        removedByType: { meshes: 2 },
        removed: [
          { name: "Mesh.001", type: "meshes" },
          { name: "Mesh.002", type: "meshes" },
        ],
        errors: [{ name: "Material.001", type: "materials", reason: "in use by driver" }],
      });

      const client = createMockClient(async () => mockOutput);
      const tool = createCleanupDatablocksTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.errors).toBeDefined();
      expect(parsed.errors.length).toBe(1);
      expect(parsed.errors[0].reason).toBe("in use by driver");
    });
  });

  describe("blender_file_integrity", () => {
    it("returns file integrity result for saved file", async () => {
      const mockOutput = JSON.stringify({
        filePath: "//mock/project.blend",
        fileSizeBytes: 1048576,
        lastModified: "2025-01-15T10:30:00Z",
        hasUnsavedChanges: false,
        externalModificationDetected: false,
        missingReferences: {
          total: 2,
          byType: { images: 2 },
          items: [
            { type: "image", name: "texture.png", expectedPath: "//textures/texture.png" },
            { type: "image", name: "normal.png", expectedPath: "//textures/normal.png" },
          ],
        },
      });

      const client = createMockClient(async () => mockOutput);
      const tool = createFileIntegrityTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.filePath).toBe("//mock/project.blend");
      expect(parsed.missingReferences.total).toBe(2);
      expect(parsed.missingReferences.items.length).toBe(2);
    });

    it("returns null metadata for unsaved file", async () => {
      const mockOutput = JSON.stringify({
        filePath: null,
        fileSizeBytes: null,
        lastModified: null,
        hasUnsavedChanges: true,
        missingReferences: { total: 0, byType: {}, items: [] },
      });

      const client = createMockClient(async () => mockOutput);
      const tool = createFileIntegrityTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.filePath).toBeNull();
      expect(parsed.fileSizeBytes).toBeNull();
      expect(parsed.lastModified).toBeNull();
      expect(parsed.hasUnsavedChanges).toBe(true);
    });

    it("returns error on execution failure", async () => {
      const client = createMockClient(async () => {
        throw new Error("Blender disconnected");
      });
      const tool = createFileIntegrityTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    });
  });

  describe("blender_performance_metrics", () => {
    it("returns validated performance metrics", async () => {
      const mockOutput = JSON.stringify({
        memory: { usedMB: 1024.5, totalMB: 8192.3 },
        scene: {
          objectCount: 42,
          polygonCount: 150000,
          vertexCount: 75000,
          materialCount: 8,
        },
        gpuAvailable: true,
        gpu: { deviceName: "NVIDIA RTX 4090", memoryUsageMB: 4096.7 },
      });

      const client = createMockClient(async () => mockOutput);
      const tool = createPerformanceMetricsTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.memory.usedMB).toBe(1025); // rounded
      expect(parsed.memory.totalMB).toBe(8192); // rounded
      expect(parsed.scene.objectCount).toBe(42);
      expect(parsed.gpuAvailable).toBe(true);
      expect(parsed.gpu.deviceName).toBe("NVIDIA RTX 4090");
      expect(parsed.gpu.memoryUsageMB).toBe(4097); // rounded
    });

    it("omits GPU when unavailable", async () => {
      const mockOutput = JSON.stringify({
        memory: { usedMB: 512, totalMB: 4096 },
        scene: { objectCount: 1, polygonCount: 0, vertexCount: 0, materialCount: 0 },
        gpuAvailable: false,
      });

      const client = createMockClient(async () => mockOutput);
      const tool = createPerformanceMetricsTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.gpuAvailable).toBe(false);
      expect(parsed.gpu).toBeUndefined();
    });
  });

  describe("blender_mesh_validate", () => {
    it("returns validation result with quality scoring", async () => {
      const mockOutput = JSON.stringify({
        invertedFaces: 0,
        nonManifoldEdges: 2,
        looseVertices: 5,
        faceOrientationIssues: 0,
        isValid: false,
        qualityScore: 80,
        qualityGrade: "B",
        breakdown: {
          vertexCount: 1000,
          edgeCount: 2000,
          faceCount: 500,
          nonManifoldEdgeCount: 2,
          looseVertexCount: 5,
          degenerateFaceCount: 0,
          ngonCount: 10,
          ngonPercentage: 2.0,
        },
      });

      const client = createMockClient(async () => mockOutput);
      const tool = createMeshValidateTool(defaultConfig, client);
      const result = await tool.handler({ objectName: "Cube" });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(getContentText(result.content));
      expect(parsed.success).toBe(true);
      expect(parsed.qualityScore).toBe(80);
      expect(parsed.qualityGrade).toBe("B");
      expect(parsed.breakdown.vertexCount).toBe(1000);
      expect(parsed.breakdown.ngonPercentage).toBe(2.0);
    });

    it("returns error for missing objectName", async () => {
      const client = createMockClient(async () => "{}");
      const tool = createMeshValidateTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(getContentText(result.content));
      expect(parsed.error.code).toBe("INVALID_INPUT");
    });

    it("returns error for non-mesh objects", async () => {
      const mockOutput = JSON.stringify({
        error: "Object 'Camera' is not a mesh object",
      });

      const client = createMockClient(async () => mockOutput);
      const tool = createMeshValidateTool(defaultConfig, client);
      const result = await tool.handler({ objectName: "Camera" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(getContentText(result.content));
      expect(parsed.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("blender_render_preview", () => {
    it("returns render result with file path", async () => {
      let callCount = 0;
      const client = createMockClient(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: render
          return JSON.stringify({
            filePath: "/tmp/blender_preview_123.png",
            imageData: "",
          });
        }
        // Second call: render stats
        return JSON.stringify({
          renderTimeSeconds: 2.345,
          samples: 128,
          peakMemoryMB: 512.5,
          engineName: "CYCLES",
          resolutionWidth: 480,
          resolutionHeight: 270,
          scenePolygonCount: 50000,
          gpuAvailable: true,
          gpuDeviceName: "NVIDIA RTX 4090",
          gpuMemoryMB: 4096.0,
        });
      });

      const tool = createRenderPreviewTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(getContentText(result.content));
      expect(parsed.success).toBe(true);
      expect(parsed.filePath).toContain("blender_preview");
      expect(parsed.resolution.width).toBe(480);
      expect(parsed.resolution.height).toBe(270);
    });

    it("returns error on render failure", async () => {
      const client = createMockClient(async () => {
        throw new Error("Render failed: out of memory");
      });

      const tool = createRenderPreviewTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(getContentText(result.content));
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBeDefined();
    });

    it("succeeds without render statistics if stats collection fails", async () => {
      let callCount = 0;
      const client = createMockClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ filePath: "/tmp/preview.png", imageData: "" });
        }
        // Stats call fails
        throw new Error("Stats collection failed");
      });

      const tool = createRenderPreviewTool(defaultConfig, client);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(getContentText(result.content));
      expect(parsed.success).toBe(true);
      expect(parsed.renderStatistics).toBeUndefined();
    });
  });
});
