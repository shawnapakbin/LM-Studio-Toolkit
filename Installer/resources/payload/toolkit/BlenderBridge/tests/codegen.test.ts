/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { generateCreateObjectCode } from "../src/codegen/create-object.py";
import { generateSceneSummaryCode } from "../src/codegen/scene-summary.py";
import { generateRenderPreviewCode } from "../src/codegen/render-preview.py";
import { generateExportObjCode } from "../src/codegen/export-obj.py";
import { CreateObjectParams } from "../src/types";

// Note: Files are named *.py.ts — the ".py" suffix denotes Python code generators.
// ts-jest resolves these as TypeScript modules (the .ts extension is implicit).

describe("codegen/create-object.py.ts", () => {
  describe("geometry type to bpy.ops mapping", () => {
    const geometryOpsMapping: Array<{
      type: CreateObjectParams["geometryType"];
      expectedOp: string;
    }> = [
      { type: "cube", expectedOp: "bpy.ops.mesh.primitive_cube_add" },
      { type: "sphere", expectedOp: "bpy.ops.mesh.primitive_uv_sphere_add" },
      { type: "cylinder", expectedOp: "bpy.ops.mesh.primitive_cylinder_add" },
      { type: "cone", expectedOp: "bpy.ops.mesh.primitive_cone_add" },
      { type: "torus", expectedOp: "bpy.ops.mesh.primitive_torus_add" },
      { type: "plane", expectedOp: "bpy.ops.mesh.primitive_plane_add" },
      { type: "circle", expectedOp: "bpy.ops.mesh.primitive_circle_add" },
      { type: "curve", expectedOp: "bpy.ops.curve.primitive_bezier_curve_add" },
      { type: "empty", expectedOp: "bpy.ops.object.empty_add" },
    ];

    it.each(geometryOpsMapping)(
      "$type → $expectedOp",
      ({ type, expectedOp }) => {
        const code = generateCreateObjectCode({
          name: "TestObj",
          geometryType: type,
        });
        expect(code).toContain(expectedOp);
      }
    );
  });

  describe("transform values", () => {
    it("embeds custom location as Python float tuple", () => {
      const code = generateCreateObjectCode({
        name: "Obj",
        geometryType: "cube",
        location: [1.5, -2.3, 4.0],
      });
      expect(code).toContain("location=(1.5, -2.3, 4.0)");
    });

    it("embeds custom rotation as Python float tuple", () => {
      const code = generateCreateObjectCode({
        name: "Obj",
        geometryType: "cube",
        rotation: [0.785, 1.571, 3.14],
      });
      expect(code).toContain("rotation=(0.785, 1.571, 3.14)");
    });

    it("embeds custom scale as Python float tuple", () => {
      const code = generateCreateObjectCode({
        name: "Obj",
        geometryType: "cube",
        scale: [2.0, 0.5, 3.0],
      });
      expect(code).toContain("scale=(2.0, 0.5, 3.0)");
    });

    it("uses default location (0.0, 0.0, 0.0) when not provided", () => {
      const code = generateCreateObjectCode({
        name: "Obj",
        geometryType: "cube",
      });
      expect(code).toContain("location=(0.0, 0.0, 0.0)");
    });

    it("uses default rotation (0.0, 0.0, 0.0) when not provided", () => {
      const code = generateCreateObjectCode({
        name: "Obj",
        geometryType: "cube",
      });
      expect(code).toContain("rotation=(0.0, 0.0, 0.0)");
    });

    it("uses default scale (1.0, 1.0, 1.0) when not provided", () => {
      const code = generateCreateObjectCode({
        name: "Obj",
        geometryType: "cube",
      });
      expect(code).toContain("scale=(1.0, 1.0, 1.0)");
    });

    it("formats integers as Python floats with decimal point", () => {
      const code = generateCreateObjectCode({
        name: "Obj",
        geometryType: "sphere",
        location: [1, 2, 3],
      });
      expect(code).toContain("location=(1.0, 2.0, 3.0)");
    });
  });

  describe("name assignment", () => {
    it("assigns the object name via obj.name", () => {
      const code = generateCreateObjectCode({
        name: "MyObject",
        geometryType: "cube",
      });
      expect(code).toContain('obj.name = "MyObject"');
    });

    it("escapes double quotes in the name", () => {
      const code = generateCreateObjectCode({
        name: 'Say_"Hello"',
        geometryType: "cube",
      });
      expect(code).toContain('obj.name = "Say_\\"Hello\\""');
    });

    it("escapes backslashes in the name", () => {
      const code = generateCreateObjectCode({
        name: "Path\\Name",
        geometryType: "cube",
      });
      expect(code).toContain('obj.name = "Path\\\\Name"');
    });
  });

  describe("code structure", () => {
    it("imports bpy at the top", () => {
      const code = generateCreateObjectCode({
        name: "Obj",
        geometryType: "cube",
      });
      expect(code.startsWith("import bpy")).toBe(true);
    });

    it("gets active object from context", () => {
      const code = generateCreateObjectCode({
        name: "Obj",
        geometryType: "cube",
      });
      expect(code).toContain("obj = bpy.context.active_object");
    });

    it("sets a result dict with name and type", () => {
      const code = generateCreateObjectCode({
        name: "Obj",
        geometryType: "cube",
      });
      expect(code).toContain("result =");
      expect(code).toContain('"name": obj.name');
      expect(code).toContain('"type": obj.type');
    });
  });
});

describe("codegen/scene-summary.py.ts", () => {
  it("generates code that iterates scene objects", () => {
    const code = generateSceneSummaryCode();
    expect(code).toContain("bpy.context.scene");
    expect(code).toContain("scene.objects");
  });

  it("captures object name, type, and parent", () => {
    const code = generateSceneSummaryCode();
    expect(code).toContain('"name": obj.name');
    expect(code).toContain('"type": obj.type');
    expect(code).toContain("obj.parent.name if obj.parent else None");
  });

  it("captures active object", () => {
    const code = generateSceneSummaryCode();
    expect(code).toContain("bpy.context.active_object");
  });

  it("captures render settings", () => {
    const code = generateSceneSummaryCode();
    expect(code).toContain("render.resolution_x");
    expect(code).toContain("render.resolution_y");
    expect(code).toContain("render.engine");
    expect(code).toContain("render.image_settings.file_format");
  });

  it("sets a result dict with objects, activeObject, and renderSettings", () => {
    const code = generateSceneSummaryCode();
    expect(code).toContain('"objects"');
    expect(code).toContain('"activeObject"');
    expect(code).toContain('"renderSettings"');
    expect(code).toContain("result =");
  });
});

describe("codegen/render-preview.py.ts", () => {
  it("uses default resolution 480x270 when not specified", () => {
    const code = generateRenderPreviewCode({ outputPath: "/tmp/preview.png" });
    expect(code).toContain("render.resolution_x = 480");
    expect(code).toContain("render.resolution_y = 270");
  });

  it("uses custom resolution when specified", () => {
    const code = generateRenderPreviewCode({
      outputPath: "/tmp/preview.png",
      width: 1920,
      height: 1080,
    });
    expect(code).toContain("render.resolution_x = 1920");
    expect(code).toContain("render.resolution_y = 1080");
  });

  it("sets output format to PNG", () => {
    const code = generateRenderPreviewCode({ outputPath: "/tmp/preview.png" });
    expect(code).toContain('file_format = "PNG"');
  });

  it("sets the output file path", () => {
    const code = generateRenderPreviewCode({ outputPath: "/tmp/render/preview.png" });
    expect(code).toContain('render.filepath = "/tmp/render/preview.png"');
  });

  it("calls render with write_still=True", () => {
    const code = generateRenderPreviewCode({ outputPath: "/tmp/preview.png" });
    expect(code).toContain("bpy.ops.render.render(write_still=True)");
  });

  it("sets a result dict with filePath", () => {
    const code = generateRenderPreviewCode({ outputPath: "/tmp/preview.png" });
    expect(code).toContain('"filePath"');
    expect(code).toContain("result =");
  });

  it("normalizes backslashes in Windows paths", () => {
    const code = generateRenderPreviewCode({ outputPath: "C:\\Users\\test\\preview.png" });
    expect(code).toContain("C:/Users/test/preview.png");
    expect(code).not.toContain("\\");
  });
});

describe("codegen/export-obj.py.ts", () => {
  it("checks for active object before exporting", () => {
    const code = generateExportObjCode({ outputPath: "/tmp/export.obj" });
    expect(code).toContain("bpy.context.active_object");
    expect(code).toContain("active_obj is None");
    expect(code).toContain("raise Exception");
  });

  it("uses bpy.ops.wm.obj_export (Blender 4.0+ API)", () => {
    const code = generateExportObjCode({ outputPath: "/tmp/export.obj" });
    expect(code).toContain("bpy.ops.wm.obj_export");
  });

  it("sets the filepath parameter", () => {
    const code = generateExportObjCode({ outputPath: "/tmp/scene/export.obj" });
    expect(code).toContain('filepath="/tmp/scene/export.obj"');
  });

  it("exports only selected objects", () => {
    const code = generateExportObjCode({ outputPath: "/tmp/export.obj" });
    expect(code).toContain("export_selected_objects=True");
  });

  it("sets a result dict with filePath and objectName", () => {
    const code = generateExportObjCode({ outputPath: "/tmp/export.obj" });
    expect(code).toContain('"filePath"');
    expect(code).toContain('"objectName"');
    expect(code).toContain("result =");
  });

  it("normalizes backslashes in Windows paths", () => {
    const code = generateExportObjCode({ outputPath: "C:\\Models\\cube.obj" });
    expect(code).toContain("C:/Models/cube.obj");
    expect(code).not.toContain("\\");
  });
});
