/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { generateCreateObjectCode } from "../src/codegen/create-object.py";
import { CreateObjectParams } from "../src/types";

describe("generateCreateObjectCode", () => {
  it("generates correct code for a cube with defaults", () => {
    const params: CreateObjectParams = {
      name: "MyCube",
      geometryType: "cube",
    };

    const code = generateCreateObjectCode(params);

    expect(code).toContain("import bpy");
    expect(code).toContain("bpy.ops.mesh.primitive_cube_add(");
    expect(code).toContain("location=(0.0, 0.0, 0.0)");
    expect(code).toContain("rotation=(0.0, 0.0, 0.0)");
    expect(code).toContain("scale=(1.0, 1.0, 1.0)");
    expect(code).toContain('obj.name = "MyCube"');
    expect(code).toContain('result = {"name": obj.name, "type": obj.type}');
  });

  it("generates correct code for a sphere with custom transforms", () => {
    const params: CreateObjectParams = {
      name: "MySphere",
      geometryType: "sphere",
      location: [1.5, 2.0, -3.5],
      rotation: [0.785, 1.57, 0],
      scale: [2.0, 2.0, 2.0],
    };

    const code = generateCreateObjectCode(params);

    expect(code).toContain("bpy.ops.mesh.primitive_uv_sphere_add(");
    expect(code).toContain("location=(1.5, 2.0, -3.5)");
    expect(code).toContain("rotation=(0.785, 1.57, 0.0)");
    expect(code).toContain("scale=(2.0, 2.0, 2.0)");
    expect(code).toContain('obj.name = "MySphere"');
  });

  it("maps all geometry types to correct bpy.ops calls", () => {
    const mappings: Record<CreateObjectParams["geometryType"], string> = {
      cube: "bpy.ops.mesh.primitive_cube_add",
      sphere: "bpy.ops.mesh.primitive_uv_sphere_add",
      cylinder: "bpy.ops.mesh.primitive_cylinder_add",
      cone: "bpy.ops.mesh.primitive_cone_add",
      torus: "bpy.ops.mesh.primitive_torus_add",
      plane: "bpy.ops.mesh.primitive_plane_add",
      circle: "bpy.ops.mesh.primitive_circle_add",
      curve: "bpy.ops.curve.primitive_bezier_curve_add",
      empty: "bpy.ops.object.empty_add",
    };

    for (const [type, opsCall] of Object.entries(mappings)) {
      const code = generateCreateObjectCode({
        name: "Test",
        geometryType: type as CreateObjectParams["geometryType"],
      });
      expect(code).toContain(`${opsCall}(`);
    }
  });

  it("formats integer values as Python floats", () => {
    const params: CreateObjectParams = {
      name: "IntTest",
      geometryType: "plane",
      location: [1, 2, 3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };

    const code = generateCreateObjectCode(params);

    expect(code).toContain("location=(1.0, 2.0, 3.0)");
    expect(code).toContain("rotation=(0.0, 0.0, 0.0)");
    expect(code).toContain("scale=(1.0, 1.0, 1.0)");
  });

  it("handles curve type with bpy.ops.curve call", () => {
    const code = generateCreateObjectCode({
      name: "MyCurve",
      geometryType: "curve",
    });

    expect(code).toContain("bpy.ops.curve.primitive_bezier_curve_add(");
    expect(code).toContain('obj.name = "MyCurve"');
  });

  it("handles empty type with bpy.ops.object call", () => {
    const code = generateCreateObjectCode({
      name: "MyEmpty",
      geometryType: "empty",
    });

    expect(code).toContain("bpy.ops.object.empty_add(");
    expect(code).toContain('obj.name = "MyEmpty"');
  });

  it("preserves decimal values in transforms", () => {
    const code = generateCreateObjectCode({
      name: "Precise",
      geometryType: "cone",
      location: [1.234, 5.678, 9.012],
      rotation: [3.14159, 0.5, 1.0],
      scale: [0.5, 0.75, 1.25],
    });

    expect(code).toContain("location=(1.234, 5.678, 9.012)");
    expect(code).toContain("rotation=(3.14159, 0.5, 1.0)");
    expect(code).toContain("scale=(0.5, 0.75, 1.25)");
  });

  it("includes comment describing the primitive type", () => {
    const code = generateCreateObjectCode({
      name: "Torus1",
      geometryType: "torus",
    });

    expect(code).toContain("# Create torus primitive");
  });
});
