import { detectFormat } from "../../src/types";

describe("detectFormat", () => {
  it("returns 'obj' for .obj extension", () => {
    expect(detectFormat("model.obj")).toBe("obj");
  });

  it("returns 'glb' for .glb extension", () => {
    expect(detectFormat("scene.glb")).toBe("glb");
  });

  it("returns 'gltf' for .gltf extension", () => {
    expect(detectFormat("scene.gltf")).toBe("gltf");
  });

  it("is case-insensitive", () => {
    expect(detectFormat("model.OBJ")).toBe("obj");
    expect(detectFormat("scene.GLB")).toBe("glb");
    expect(detectFormat("scene.GLTF")).toBe("gltf");
    expect(detectFormat("model.Obj")).toBe("obj");
  });

  it("returns null for unsupported extensions", () => {
    expect(detectFormat("model.fbx")).toBeNull();
    expect(detectFormat("model.stl")).toBeNull();
    expect(detectFormat("model.blend")).toBeNull();
    expect(detectFormat("model.txt")).toBeNull();
  });

  it("returns null for files with no extension", () => {
    expect(detectFormat("model")).toBeNull();
    expect(detectFormat("")).toBeNull();
  });

  it("handles paths with directories", () => {
    expect(detectFormat("/path/to/model.obj")).toBe("obj");
    expect(detectFormat("C:\\Users\\data\\scene.glb")).toBe("glb");
    expect(detectFormat("relative/path/model.gltf")).toBe("gltf");
  });

  it("handles files with multiple dots", () => {
    expect(detectFormat("my.model.v2.obj")).toBe("obj");
    expect(detectFormat("scene.backup.glb")).toBe("glb");
  });
});
