import fs from "fs";
import path from "path";
import type { Response } from "express";
import type {
  CameraState,
  InteractionEvent,
  MaterialInfo,
  MaterialProps,
  PollResult,
  SceneObject,
  Vec3,
} from "./types";

export class SceneManager {
  private objects: Map<string, SceneObject> = new Map();
  private interactions: InteractionEvent[] = [];
  private clients: Response[] = [];
  private delegatePort: number | null = null;
  private cameraPosition: CameraState | null = null;

  // --- Scene operations ---

  addObject(obj: SceneObject): void {
    if (!obj.id || obj.id.length < 1 || obj.id.length > 64) {
      throw new Error("Object id must be between 1 and 64 characters");
    }
    if (this.objects.has(obj.id)) {
      throw new Error(`Object already exists: ${obj.id}`);
    }
    const absolutePath = path.resolve(obj.workspaceRoot, obj.filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${obj.filePath}`);
    }
    this.objects.set(obj.id, { ...obj });
    this.broadcast("scene_update", { action: "add", objectId: obj.id });
  }

  removeObject(id: string): void {
    if (!this.objects.has(id)) {
      throw new Error(`Object not found: ${id}`);
    }
    this.objects.delete(id);
    this.broadcast("scene_update", { action: "remove", objectId: id });
  }

  transformObject(
    id: string,
    transform: Partial<{ position: Vec3; rotation: Vec3; scale: Vec3 }>,
  ): void {
    const obj = this.objects.get(id);
    if (!obj) {
      throw new Error(`Object not found: ${id}`);
    }
    if (transform.position !== undefined) {
      obj.position = transform.position;
    }
    if (transform.rotation !== undefined) {
      obj.rotation = transform.rotation;
    }
    if (transform.scale !== undefined) {
      obj.scale = transform.scale;
    }
    this.broadcast("scene_update", { action: "transform", objectId: id });
  }

  listObjects(): SceneObject[] {
    return Array.from(this.objects.values());
  }

  // --- Material operations ---

  setMaterial(objectId: string, props: Partial<MaterialProps>): void {
    const obj = this.objects.get(objectId);
    if (!obj) {
      throw new Error(`Object not found: ${objectId}`);
    }
    if (props.roughness !== undefined) {
      if (props.roughness < 0 || props.roughness > 1) {
        throw new Error("roughness must be between 0 and 1");
      }
    }
    if (props.metalness !== undefined) {
      if (props.metalness < 0 || props.metalness > 1) {
        throw new Error("metalness must be between 0 and 1");
      }
    }
    // Find or create the default material override (no meshName = whole object)
    let override = obj.materials.find((m) => m.meshName === undefined);
    if (!override) {
      override = { props: {} };
      obj.materials.push(override);
    }
    // Merge provided props into existing override
    override.props = { ...override.props, ...props };
    this.broadcast("scene_update", { action: "material", objectId });
  }

  listMaterials(): MaterialInfo[] {
    const results: MaterialInfo[] = [];
    for (const obj of this.objects.values()) {
      const override = obj.materials.find((m) => m.meshName === undefined);
      const props = override?.props ?? {};
      results.push({
        name: override?.meshName ?? "default",
        objectId: obj.id,
        color: props.color ?? "#ffffff",
        roughness: props.roughness ?? 0.5,
        metalness: props.metalness ?? 0.0,
        emissive: props.emissive ?? "#000000",
      });
    }
    return results;
  }

  // --- Interaction lifecycle ---

  addInteraction(event: Omit<InteractionEvent, "id" | "timestamp" | "state">): InteractionEvent {
    const id = `int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const interaction: InteractionEvent = {
      ...event,
      id,
      timestamp: Date.now(),
      state: "pending",
    };
    this.interactions.push(interaction);
    this.broadcast("pin_state", { id, state: "pending" });
    return interaction;
  }

  pollInteractions(): PollResult {
    const events = [...this.interactions];
    this.interactions = [];
    return {
      events,
      cameraPosition: this.cameraPosition,
    };
  }

  acknowledgeInteraction(id: string): boolean {
    const interaction = this.interactions.find((i) => i.id === id);
    if (!interaction) {
      return false;
    }
    interaction.state = "resolved";
    this.broadcast("pin_state", { id, state: "resolved" });
    return true;
  }

  setCameraPosition(location: Vec3, target: Vec3): void {
    this.cameraPosition = { location, target };
  }

  // --- SSE client management ---

  addClient(client: Response): void {
    this.clients.push(client);
  }

  removeClient(client: Response): void {
    this.clients = this.clients.filter((c) => c !== client);
  }

  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        // Client disconnected, will be cleaned up on next removeClient call
      }
    }
  }

  triggerReload(): void {
    this.broadcast("reload", {});
  }

  // --- Delegate mode ---

  setDelegateMode(port: number): void {
    this.delegatePort = port;
  }
}
