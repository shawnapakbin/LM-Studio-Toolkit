import fs from "fs";
import path from "path";
import { NodeIO } from "@gltf-transform/core";
import { detectFormat } from "./types";

// --- Metadata Interfaces ---

export interface ObjMetadata {
  format: "obj";
  vertices: number;
  faces: number;
  groups: string[];
  materials: string[];
  fileSize: number;
}

export interface GltfMetadata {
  format: "glb" | "gltf";
  meshCount: number;
  materialCount: number;
  animationCount: number;
  totalVertexCount: number;
  fileSize: number;
}

export type ModelMetadata = ObjMetadata | GltfMetadata;

/**
 * Extracts metadata from a 3D model file.
 * Supports OBJ, GLB, and glTF formats.
 *
 * @param filePath - Relative path to the model file from workspaceRoot
 * @param workspaceRoot - Absolute path to the workspace root directory
 * @returns Metadata about the model file
 * @throws Error if the format is unsupported
 */
export async function extractMetadata(
  filePath: string,
  workspaceRoot: string,
): Promise<ModelMetadata> {
  const absolutePath = path.resolve(workspaceRoot, filePath);
  const format = detectFormat(absolutePath);

  if (!format) {
    throw new Error("Unsupported format");
  }

  const fileSize = fs.statSync(absolutePath).size;

  if (format === "obj") {
    return extractObjMetadata(absolutePath, fileSize);
  }

  return extractGltfMetadata(absolutePath, format, fileSize);
}

function extractObjMetadata(absolutePath: string, fileSize: number): ObjMetadata {
  const content = fs.readFileSync(absolutePath, "utf-8");
  const lines = content.split("\n");

  let vertices = 0;
  let faces = 0;
  const groups: string[] = [];
  const materials: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("v ")) {
      vertices++;
    } else if (trimmed.startsWith("f ")) {
      faces++;
    } else if (trimmed.startsWith("g ")) {
      const groupName = trimmed.substring(2).trim();
      if (groupName && !groups.includes(groupName)) {
        groups.push(groupName);
      }
    } else if (trimmed.startsWith("usemtl ")) {
      const materialName = trimmed.substring(7).trim();
      if (materialName && !materials.includes(materialName)) {
        materials.push(materialName);
      }
    }
  }

  return {
    format: "obj",
    vertices,
    faces,
    groups,
    materials,
    fileSize,
  };
}

async function extractGltfMetadata(
  absolutePath: string,
  format: "glb" | "gltf",
  fileSize: number,
): Promise<GltfMetadata> {
  const io = new NodeIO();
  const document = await io.read(absolutePath);
  const root = document.getRoot();

  const meshes = root.listMeshes();
  const materialsList = root.listMaterials();
  const animations = root.listAnimations();

  let totalVertexCount = 0;
  for (const mesh of meshes) {
    for (const primitive of mesh.listPrimitives()) {
      const positionAccessor = primitive.getAttribute("POSITION");
      if (positionAccessor) {
        totalVertexCount += positionAccessor.getCount();
      }
    }
  }

  return {
    format,
    meshCount: meshes.length,
    materialCount: materialsList.length,
    animationCount: animations.length,
    totalVertexCount,
    fileSize,
  };
}
