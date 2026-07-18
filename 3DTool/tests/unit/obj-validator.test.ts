import { validateObj } from "../../src/obj-validator";

describe("validateObj", () => {
  describe("valid OBJ content", () => {
    it("returns valid=true for a well-formed OBJ with no issues", () => {
      const content = `# Simple cube
v 0.0 0.0 0.0
v 1.0 0.0 0.0
v 1.0 1.0 0.0
v 0.0 1.0 0.0
f 1 2 3
f 1 3 4`;

      const report = validateObj(content);
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
      expect(report.warnings).toHaveLength(0);
    });

    it("returns valid=true for empty content", () => {
      const report = validateObj("");
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
      expect(report.warnings).toHaveLength(0);
    });

    it("returns valid=true for only comments and blank lines", () => {
      const content = `# This is a comment
# Another comment

`;
      const report = validateObj(content);
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it("handles all valid OBJ keywords without error", () => {
      const content = `# Full OBJ example
mtllib materials.mtl
o Cube
g MainGroup
s 1
usemtl DefaultMaterial
v 0 0 0
v 1 0 0
v 1 1 0
vt 0.0 0.0
vt 1.0 0.0
vn 0 0 1
f 1/1/1 2/2/1 3/2/1`;

      const report = validateObj(content);
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });
  });

  describe("face index validation", () => {
    it("detects out-of-range positive face indices", () => {
      const content = `v 0 0 0
v 1 0 0
v 1 1 0
f 1 2 5`;

      const report = validateObj(content);
      expect(report.valid).toBe(false);
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors[0].line).toBe(4);
      expect(report.errors[0].severity).toBe("error");
      expect(report.errors[0].message).toContain("5");
    });

    it("handles negative face indices correctly", () => {
      const content = `v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f -4 -3 -2
f -3 -2 -1`;

      const report = validateObj(content);
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it("detects out-of-range negative face indices", () => {
      const content = `v 0 0 0
v 1 0 0
v 1 1 0
f -5 -3 -2`;

      const report = validateObj(content);
      expect(report.valid).toBe(false);
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors[0].message).toContain("-5");
    });

    it("handles vertex/texture/normal face format (v/vt/vn)", () => {
      const content = `v 0 0 0
v 1 0 0
v 1 1 0
vt 0 0
vt 1 0
vt 1 1
vn 0 0 1
f 1/1/1 2/2/1 3/3/1`;

      const report = validateObj(content);
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it("handles vertex//normal face format (v//vn)", () => {
      const content = `v 0 0 0
v 1 0 0
v 1 1 0
vn 0 0 1
f 1//1 2//1 3//1`;

      const report = validateObj(content);
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it("detects face with fewer than 3 vertices", () => {
      const content = `v 0 0 0
v 1 0 0
v 1 1 0
f 1 2`;

      const report = validateObj(content);
      expect(report.valid).toBe(false);
      expect(report.errors[0].message).toContain("at least 3");
    });
  });

  describe("syntax error detection", () => {
    it("detects unrecognized keywords", () => {
      const content = `v 0 0 0
v 1 0 0
v 1 1 0
invalidkeyword some data
f 1 2 3`;

      const report = validateObj(content);
      expect(report.valid).toBe(false);
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors[0].line).toBe(4);
      expect(report.errors[0].message).toContain("invalidkeyword");
    });

    it("detects multiple syntax errors with correct line numbers", () => {
      const content = `v 0 0 0
bad1 data
v 1 0 0
bad2 more
v 1 1 0
f 1 2 3`;

      const report = validateObj(content);
      expect(report.valid).toBe(false);
      expect(report.errors).toHaveLength(2);
      expect(report.errors[0].line).toBe(2);
      expect(report.errors[1].line).toBe(4);
    });
  });

  describe("orphan vertex detection", () => {
    it("warns about vertices not referenced by any face", () => {
      const content = `v 0 0 0
v 1 0 0
v 1 1 0
v 5 5 5
f 1 2 3`;

      const report = validateObj(content);
      expect(report.valid).toBe(true); // orphans are warnings, not errors
      expect(report.warnings.length).toBeGreaterThan(0);
      expect(report.warnings[0].severity).toBe("warning");
      expect(report.warnings[0].message).toContain("Orphan vertex");
      expect(report.warnings[0].message).toContain("4");
    });

    it("does not warn when all vertices are referenced", () => {
      const content = `v 0 0 0
v 1 0 0
v 1 1 0
f 1 2 3`;

      const report = validateObj(content);
      expect(report.warnings).toHaveLength(0);
    });
  });

  describe("error cap", () => {
    it("caps total entries at 50", () => {
      // Generate 60 invalid lines
      const lines: string[] = [];
      for (let i = 0; i < 60; i++) {
        lines.push(`invalid_keyword_${i} data`);
      }
      const content = lines.join("\n");

      const report = validateObj(content);
      expect(report.errors.length + report.warnings.length).toBeLessThanOrEqual(50);
    });
  });

  describe("ValidationReport structure invariant", () => {
    it("valid is false iff errors array is non-empty", () => {
      const validContent = `v 0 0 0\nv 1 0 0\nv 1 1 0\nf 1 2 3`;
      const invalidContent = `v 0 0 0\nv 1 0 0\nv 1 1 0\nf 1 2 99`;

      const validReport = validateObj(validContent);
      const invalidReport = validateObj(invalidContent);

      expect(validReport.valid).toBe(true);
      expect(validReport.errors).toHaveLength(0);

      expect(invalidReport.valid).toBe(false);
      expect(invalidReport.errors.length).toBeGreaterThan(0);
    });

    it("all entries in errors have severity 'error'", () => {
      const content = `bad_keyword stuff\nv 0 0 0\nv 1 0 0\nv 1 1 0\nf 1 2 99`;
      const report = validateObj(content);

      for (const entry of report.errors) {
        expect(entry.severity).toBe("error");
      }
    });

    it("all entries in warnings have severity 'warning'", () => {
      const content = `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 9 9 9\nf 1 2 3`;
      const report = validateObj(content);

      for (const entry of report.warnings) {
        expect(entry.severity).toBe("warning");
      }
    });
  });

  describe("CRLF handling", () => {
    it("handles Windows-style line endings", () => {
      const content = "v 0 0 0\r\nv 1 0 0\r\nv 1 1 0\r\nf 1 2 3";
      const report = validateObj(content);
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });
  });
});
