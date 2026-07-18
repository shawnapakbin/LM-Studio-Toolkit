import path from "path";

// --- Geometry & Transforms ---

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vec3;
  rotation: Vec3; // degrees
  scale: Vec3;
}

// --- Scene ---

export interface SceneObject {
  id: string;
  filePath: string;
  workspaceRoot: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  materials: MaterialOverride[];
}

// --- Materials ---

export interface MaterialProps {
  color: string; // hex string e.g. "#8899bb"
  roughness: number; // 0.0 - 1.0
  metalness: number; // 0.0 - 1.0
  emissive: string; // hex string
}

export interface MaterialOverride {
  meshName?: string; // optional: target specific mesh within object
  props: Partial<MaterialProps>;
}

export interface MaterialInfo {
  name: string;
  objectId: string;
  color: string;
  roughness: number;
  metalness: number;
  emissive: string;
}

// --- Interactions ---

export interface InteractionEvent {
  id: string;
  timestamp: number;
  x: number;
  y: number;
  z: number;
  meshId: string;
  prompt: string;
  faceNormal: Vec3;
  faceIndex: number;
  objectPath: string;
  objectId: string;
  state: "pending" | "resolved" | "stale";
}

export interface CameraState {
  location: Vec3;
  target: Vec3;
}

export interface PollResult {
  events: InteractionEvent[];
  cameraPosition: CameraState | null;
}

// --- Validation ---

export interface ValidationEntry {
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationEntry[];
  warnings: ValidationEntry[];
}

// --- History ---

export interface BackupEntry {
  id: string;
  timestamp: number;
}

// --- SSE Events ---

export type SSEEvent =
  | { type: "reload" }
  | {
      type: "pin_state";
      data: { id: string; state: "pending" | "resolved" | "stale" };
    }
  | {
      type: "scene_update";
      data: {
        action: "add" | "remove" | "transform" | "material";
        objectId: string;
      };
    };

// --- Format Detection ---

export type SupportedFormat = "obj" | "glb" | "gltf";

/**
 * Detects the 3D format from a file path based on its extension.
 * Returns 'obj', 'glb', or 'gltf' for supported formats, or null otherwise.
 * Matching is case-insensitive.
 */
export function detectFormat(filePath: string): SupportedFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".obj":
      return "obj";
    case ".glb":
      return "glb";
    case ".gltf":
      return "gltf";
    default:
      return null;
  }
}
