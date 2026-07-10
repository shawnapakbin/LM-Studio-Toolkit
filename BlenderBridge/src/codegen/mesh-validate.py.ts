/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Python code generator for mesh geometry validation.
 * Produces code that uses Blender's bmesh module to analyze mesh
 * health and report issues such as inverted normals, non-manifold
 * edges, loose vertices, and face orientation problems.
 */

/**
 * Generates Python code that validates mesh geometry for a given object.
 * The generated code:
 * - Gets the object by name from bpy.data.objects
 * - Creates a bmesh from the object's mesh data
 * - Checks for inverted normals (faces with flipped orientation)
 * - Counts non-manifold edges
 * - Counts loose vertices (no connected edges)
 * - Detects face orientation issues (faces oriented differently from neighbors)
 * - Returns structured JSON with validation results
 *
 * @param objectName - The name of the Blender object to validate
 * @returns Generated Python code string
 */
export function generateMeshValidateCode(objectName: string): string {
  // Escape backslashes and quotes in the object name for safe Python string embedding
  const escapedName = objectName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  return `import bpy
import bmesh
import json
from mathutils import Vector

object_name = "${escapedName}"

# Validate object exists
if object_name not in bpy.data.objects:
    result = {"error": "Object not found: " + object_name}
else:
    obj = bpy.data.objects[object_name]

    # Validate object is a mesh
    if obj.type != "MESH":
        result = {"error": "Object is not a mesh: " + object_name + " (type: " + obj.type + ")"}
    else:
        mesh = obj.data

        # Create bmesh for analysis
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.normal_update()

        # Ensure lookup tables are available
        bm.faces.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.verts.ensure_lookup_table()

        # Count inverted faces (normal pointing inward)
        # A face is considered inverted if its normal points away from
        # the face center relative to the object center
        inverted_faces = 0
        for face in bm.faces:
            # Calculate direction from object center to face center
            face_center = face.calc_center_median()
            if face_center.length > 0.0001:
                direction = face_center.normalized()
                # If normal points opposite to the outward direction, it's inverted
                if face.normal.dot(direction) < 0:
                    inverted_faces += 1

        # Count non-manifold edges
        non_manifold_edges = 0
        for edge in bm.edges:
            if not edge.is_manifold:
                non_manifold_edges += 1

        # Count loose vertices (vertices with no connected edges)
        loose_vertices = 0
        for vert in bm.verts:
            if len(vert.link_edges) == 0:
                loose_vertices += 1

        # Detect face orientation issues
        # A face has orientation issues if it's oriented differently from
        # the majority of its neighboring faces (sharing an edge)
        face_orientation_issues = 0
        for face in bm.faces:
            for edge in face.edges:
                linked_faces = edge.link_faces
                if len(linked_faces) == 2:
                    other_face = linked_faces[0] if linked_faces[1] == face else linked_faces[1]
                    # Two adjacent faces should have normals pointing in roughly
                    # the same general direction (dot product > 0 for convex surfaces)
                    # but for non-manifold detection, we check if the winding is
                    # consistent: shared edge vertices should be in opposite order
                    shared_verts = set(edge.verts)
                    face_verts = list(face.verts)
                    other_verts = list(other_face.verts)

                    # Find the order of shared vertices in each face
                    sv = list(shared_verts)
                    idx_a = [face_verts.index(sv[0]), face_verts.index(sv[1])]
                    idx_b = [other_verts.index(sv[0]), other_verts.index(sv[1])]

                    # In consistent winding, shared edge is traversed in opposite directions
                    a_forward = (idx_a[1] - idx_a[0]) % len(face_verts) == 1
                    b_forward = (idx_b[1] - idx_b[0]) % len(other_verts) == 1

                    if a_forward == b_forward:
                        face_orientation_issues += 1
                        break  # Only count each face once

        # Count degenerate faces (area <= 1e-6)
        degenerate_faces = 0
        for face in bm.faces:
            if face.calc_area() <= 1e-6:
                degenerate_faces += 1

        # Count n-gons (faces with more than 4 vertices)
        ngon_count = 0
        for face in bm.faces:
            if len(face.verts) > 4:
                ngon_count += 1

        # Compute n-gon percentage
        face_count = len(bm.faces)
        if face_count > 0:
            ngon_percentage = round(ngon_count / face_count * 100, 1)
        else:
            ngon_percentage = 0.0

        # Compute quality score
        score = 100
        score -= non_manifold_edges * 5
        score -= degenerate_faces * 4
        score -= loose_vertices * 2
        score -= ngon_count * 1
        score = max(0, min(100, score))

        # Derive quality grade
        if score >= 90:
            grade = "A"
        elif score >= 80:
            grade = "B"
        elif score >= 70:
            grade = "C"
        elif score >= 60:
            grade = "D"
        else:
            grade = "F"

        is_valid = (inverted_faces == 0 and non_manifold_edges == 0 and
                    loose_vertices == 0 and face_orientation_issues == 0)

        result = {
            "invertedFaces": inverted_faces,
            "nonManifoldEdges": non_manifold_edges,
            "looseVertices": loose_vertices,
            "faceOrientationIssues": face_orientation_issues,
            "isValid": is_valid,
            "qualityScore": score,
            "qualityGrade": grade,
            "breakdown": {
                "vertexCount": len(bm.verts),
                "edgeCount": len(bm.edges),
                "faceCount": face_count,
                "nonManifoldEdgeCount": non_manifold_edges,
                "looseVertexCount": loose_vertices,
                "degenerateFaceCount": degenerate_faces,
                "ngonCount": ngon_count,
                "ngonPercentage": ngon_percentage
            }
        }

        bm.free()
`;
}
