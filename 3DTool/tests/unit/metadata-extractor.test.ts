import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { Document, NodeIO } from "@gltf-transform/core";
import { GltfMetadata, ObjMetadata, extractMetadata } from "../../src/metadata-extractor";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

describe("extractMetadata", () => {
  describe("OBJ format", () => {
    it("extracts correct vertex and face counts from a known cube OBJ", async () => {
      const metadata = await extractMetadata("cube.obj", FIXTURES_DIR);

      expect(metadata.format).toBe("obj");
      const obj = metadata as ObjMetadata;
      expect(obj.vertices).toBe(8);
      expect(obj.faces).toBe(6);
    });

    it("extracts groups and materials from OBJ with known group/material names", async () => {
      const metadata = await extractMetadata("cube.obj", FIXTURES_DIR);

      const obj = metadata as ObjMetadata;
      expect(obj.groups).toEqual(["Front", "Back"]);
      expect(obj.materials).toEqual(["RedMaterial", "BlueMaterial"]);
    });

    it("reports correct file size for OBJ", async () => {
      const metadata = await extractMetadata("cube.obj", FIXTURES_DIR);

      const expectedSize = fs.statSync(path.join(FIXTURES_DIR, "cube.obj")).size;
      expect(metadata.fileSize).toBe(expectedSize);
      expect(metadata.fileSize).toBeGreaterThan(0);
    });
  });

  describe("GLB format", () => {
    const glbFixturePath = path.join(FIXTURES_DIR, "test-scene.glb");

    beforeAll(async () => {
      // Programmatically create a minimal GLB fixture using @gltf-transform/core
      const document = new Document();

      // Create a buffer for accessor data (required for GLB writing)
      const buffer = document.createBuffer();

      // Create two materials
      const mat1 = document.createMaterial("WoodMaterial");
      const mat2 = document.createMaterial("MetalMaterial");

      // Create a mesh with a triangle (3 vertices)
      const position1 = document
        .createAccessor()
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .setType("VEC3")
        .setBuffer(buffer);
      const prim1 = document
        .createPrimitive()
        .setAttribute("POSITION", position1)
        .setMaterial(mat1);
      const mesh1 = document.createMesh("CubeMesh").addPrimitive(prim1);

      // Create a second mesh with a quad (4 vertices)
      const position2 = document
        .createAccessor()
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]))
        .setType("VEC3")
        .setBuffer(buffer);
      const prim2 = document
        .createPrimitive()
        .setAttribute("POSITION", position2)
        .setMaterial(mat2);
      const mesh2 = document.createMesh("PlaneMesh").addPrimitive(prim2);

      // Create nodes for the meshes
      const node1 = document.createNode("CubeNode").setMesh(mesh1);
      const node2 = document.createNode("PlaneNode").setMesh(mesh2);

      // Create a scene
      const _scene = document.createScene("MainScene").addChild(node1).addChild(node2);

      // Create an animation with a channel
      const animInput = document
        .createAccessor()
        .setArray(new Float32Array([0, 1]))
        .setType("SCALAR")
        .setBuffer(buffer);
      const animOutput = document
        .createAccessor()
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0]))
        .setType("VEC3")
        .setBuffer(buffer);
      const sampler = document.createAnimationSampler().setInput(animInput).setOutput(animOutput);
      const channel = document
        .createAnimationChannel()
        .setTargetNode(node1)
        .setTargetPath("translation")
        .setSampler(sampler);
      document.createAnimation("BounceAnimation").addSampler(sampler).addChannel(channel);

      // Write the GLB file
      const io = new NodeIO();
      await io.write(glbFixturePath, document);
    });

    afterAll(() => {
      // Clean up the generated GLB fixture
      if (fs.existsSync(glbFixturePath)) {
        fs.unlinkSync(glbFixturePath);
      }
    });

    it("extracts correct mesh count from GLB", async () => {
      const metadata = await extractMetadata("test-scene.glb", FIXTURES_DIR);

      expect(metadata.format).toBe("glb");
      const glb = metadata as GltfMetadata;
      expect(glb.meshCount).toBe(2);
    });

    it("extracts correct material count from GLB", async () => {
      const metadata = await extractMetadata("test-scene.glb", FIXTURES_DIR);

      const glb = metadata as GltfMetadata;
      expect(glb.materialCount).toBe(2);
    });

    it("extracts correct animation count from GLB", async () => {
      const metadata = await extractMetadata("test-scene.glb", FIXTURES_DIR);

      const glb = metadata as GltfMetadata;
      expect(glb.animationCount).toBe(1);
    });

    it("extracts correct total vertex count from GLB", async () => {
      const metadata = await extractMetadata("test-scene.glb", FIXTURES_DIR);

      const glb = metadata as GltfMetadata;
      // mesh1 has 3 vertices (triangle), mesh2 has 4 vertices (quad)
      expect(glb.totalVertexCount).toBe(7);
    });

    it("reports correct file size for GLB", async () => {
      const metadata = await extractMetadata("test-scene.glb", FIXTURES_DIR);

      const expectedSize = fs.statSync(glbFixturePath).size;
      expect(metadata.fileSize).toBe(expectedSize);
      expect(metadata.fileSize).toBeGreaterThan(0);
    });
  });

  describe("unsupported format", () => {
    it("throws 'Unsupported format' error for .fbx files", async () => {
      // Create a temporary file with unsupported extension
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "metadata-test-"));
      const unsupportedFile = path.join(tmpDir, "model.fbx");
      fs.writeFileSync(unsupportedFile, "fake fbx content");

      await expect(extractMetadata("model.fbx", tmpDir)).rejects.toThrow("Unsupported format");

      // Cleanup
      fs.unlinkSync(unsupportedFile);
      fs.rmdirSync(tmpDir);
    });

    it("throws 'Unsupported format' error for .stl files", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "metadata-test-"));
      const unsupportedFile = path.join(tmpDir, "model.stl");
      fs.writeFileSync(unsupportedFile, "fake stl content");

      await expect(extractMetadata("model.stl", tmpDir)).rejects.toThrow("Unsupported format");

      // Cleanup
      fs.unlinkSync(unsupportedFile);
      fs.rmdirSync(tmpDir);
    });

    it("throws 'Unsupported format' error for files with no extension", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "metadata-test-"));
      const unsupportedFile = path.join(tmpDir, "model");
      fs.writeFileSync(unsupportedFile, "some content");

      await expect(extractMetadata("model", tmpDir)).rejects.toThrow("Unsupported format");

      // Cleanup
      fs.unlinkSync(unsupportedFile);
      fs.rmdirSync(tmpDir);
    });
  });

  describe("file size reporting", () => {
    it("reports accurate file size for OBJ fixture", async () => {
      const metadata = await extractMetadata("cube.obj", FIXTURES_DIR);

      const stat = fs.statSync(path.join(FIXTURES_DIR, "cube.obj"));
      expect(metadata.fileSize).toBe(stat.size);
    });
  });
});
