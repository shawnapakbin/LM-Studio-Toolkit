import fs from "fs";
import path from "path";
import { backupAndEditFile, getObjMetadata } from "../src/file-editor";

describe("file-editor", () => {
  const testWorkspace = path.join(__dirname, "test-workspace");

  beforeAll(() => {
    if (!fs.existsSync(testWorkspace)) {
      fs.mkdirSync(testWorkspace, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // clean workspace before each test
    const files = fs.readdirSync(testWorkspace);
    for (const f of files) {
      fs.rmSync(path.join(testWorkspace, f), { recursive: true, force: true });
    }
  });

  describe("backupAndEditFile", () => {
    test("should prevent path traversal out of workspace", () => {
      const res = backupAndEditFile("../outside.obj", testWorkspace, "new content");
      expect(res.success).toBe(false);
      expect(res.error).toBe("Path out of workspace bounds");
    });

    test("should write a new file if it does not exist", () => {
      const res = backupAndEditFile("new.obj", testWorkspace, "v 1 1 1");
      expect(res.success).toBe(true);
      expect(res.backupPath).toBeUndefined();

      const written = fs.readFileSync(path.join(testWorkspace, "new.obj"), "utf-8");
      expect(written).toBe("v 1 1 1");
    });

    test("should create a backup and edit if file exists", () => {
      const filePath = "existing.obj";
      fs.writeFileSync(path.join(testWorkspace, filePath), "v 0 0 0", "utf-8");

      const res = backupAndEditFile(filePath, testWorkspace, "v 1 1 1");
      expect(res.success).toBe(true);
      expect(res.backupPath).toBeDefined();

      const written = fs.readFileSync(path.join(testWorkspace, filePath), "utf-8");
      expect(written).toBe("v 1 1 1");

      const backupContent = fs.readFileSync(res.backupPath!, "utf-8");
      expect(backupContent).toBe("v 0 0 0");
    });
  });

  describe("getObjMetadata", () => {
    test("should fail for out of bounds path", () => {
      const res = getObjMetadata("../test.obj", testWorkspace);
      expect(res.success).toBe(false);
    });

    test("should fail for missing file", () => {
      const res = getObjMetadata("missing.obj", testWorkspace);
      expect(res.success).toBe(false);
    });

    test("should correctly parse an obj file", () => {
      const objContent = [
        "v 1.0 0.0 0.0",
        "v 0.0 1.0 0.0",
        "v 0.0 0.0 1.0",
        "g my_group",
        "usemtl my_mat",
        "f 1 2 3",
      ].join("\n");
      const filePath = "test_metadata.obj";
      fs.writeFileSync(path.join(testWorkspace, filePath), objContent, "utf-8");

      const res = getObjMetadata(filePath, testWorkspace);
      expect(res.success).toBe(true);
      expect(res.data.format).toBe("obj");
      expect(res.data.vertices).toBe(3);
      expect(res.data.faces).toBe(1);
      expect(res.data.groups).toContain("my_group");
      expect(res.data.materials).toContain("my_mat");
    });
  });
});
