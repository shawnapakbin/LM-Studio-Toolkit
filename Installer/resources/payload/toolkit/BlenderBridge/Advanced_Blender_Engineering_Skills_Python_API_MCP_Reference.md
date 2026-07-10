# Advanced Blender Engineering Skills
## Python API & MCP Reference for Local LLM Instruction

---

# TABLE OF CONTENTS

1. MCP Integration & Environment Setup
2. Advanced Modeling — Procedural Geometry & BMesh
3. Complex Object Construction — Soccer Ball (Truncated Icosahedron)
4. Material Engineering — Node-Based Shaders, UV & Baking
5. Advanced Animation — Rigging, Constraints, Drivers & Physics
6. Automation Patterns — Custom Operators, Reusable Scripts, Error Handling

---

# SECTION 1: MCP Integration & Environment Setup

## 1.1 What Is MCP in the Blender Context

MCP (Model Context Protocol) is a standardized bridge that allows a local LLM to communicate with Blender in real time. The LLM generates Python script payloads; a local MCP server relays them to Blender's embedded Python interpreter via `bpy`. The most common implementation is `blender-mcp`, which exposes a socket server inside Blender and accepts script execution requests from an LLM agent.

**Key concepts:**
- The MCP server runs inside Blender as an add-on or background thread.
- The LLM sends Python strings; Blender executes them via `exec()` or a registered operator.
- All Blender state is manipulated through `bpy`, `bmesh`, and `mathutils`.
- The LLM must generate syntactically correct, context-aware Python — no interactive shell fallback.

## 1.2 Environment Prerequisites

- Blender 4.x (Python 3.11+ bundled)
- `blender-mcp` add-on installed and enabled in Blender preferences
- MCP server started via: `uvx blender-mcp` or the Blender add-on panel
- For headless use: `pip install bpy` (Blender as a Python module)

**Standard imports for all scripts:**

```python
import bpy
import bmesh
import mathutils
from mathutils import Vector, Matrix, Euler, Quaternion
import math
import random
import os
import traceback
```

## 1.3 Script Execution Context

Blender Python scripts operate in one of two contexts:

| Context | Description |
|---|---|
| `bpy.context` | Current state: active object, selected objects, scene, mode |
| `bpy.data` | All data blocks: meshes, materials, objects, actions, etc. |
| `bpy.ops` | Operators: high-level actions that mirror UI button presses |

**Safe object selection pattern (always use this before acting on objects):**

```python
def set_active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
```

**Mode switching:**

```python
def ensure_mode(mode='OBJECT'):
    if bpy.context.mode != mode:
        bpy.ops.object.mode_set(mode=mode)
```

## 1.4 Standard MCP Script Template

Every script generated for MCP execution should follow this structure:

```python
import bpy
import bmesh
import mathutils
from mathutils import Vector
import math
import traceback

def main():
    """
    Entry point for MCP-executed Blender script.
    Always wrap logic in a function to control scope.
    """
    try:
        # 1. Ensure clean state
        bpy.ops.object.select_all(action='DESELECT')

        # 2. Your logic here
        result = do_work()

        # 3. Update scene
        bpy.context.view_layer.update()
        print(f"[MCP SUCCESS] {result}")

    except Exception as e:
        print(f"[MCP ERROR] {type(e).__name__}: {e}")
        traceback.print_exc()

def do_work():
    pass  # Replace with actual logic

if __name__ == "__main__":
    main()
```

---

# SECTION 2: Advanced Modeling — Procedural Geometry & BMesh

## 2.1 BMesh API — Core Concepts

`bmesh` is Blender's in-memory mesh editing library. It is the correct and preferred method for procedurally constructing or modifying geometry via Python. Unlike `bpy.ops`, bmesh works directly on mesh data without needing operator context.

**BMesh workflow:**

```
bmesh.new()  →  add verts/edges/faces  →  bm.to_mesh(mesh)  →  bm.free()
```

**Always call `ensure_lookup_table()` after bulk vertex additions:**

```python
bm.verts.ensure_lookup_table()
bm.edges.ensure_lookup_table()
bm.faces.ensure_lookup_table()
```

## 2.2 Creating a Mesh Object from Scratch

```python
import bpy
import bmesh
from mathutils import Vector

def create_mesh_object(name="ProceduralMesh"):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj, mesh

def build_tetrahedron(name="Tetrahedron"):
    obj, mesh = create_mesh_object(name)
    bm = bmesh.new()

    verts = [
        bm.verts.new((1, 1, 1)),
        bm.verts.new((-1, -1, 1)),
        bm.verts.new((-1, 1, -1)),
        bm.verts.new((1, -1, -1)),
    ]
    bm.verts.ensure_lookup_table()

    bm.faces.new([verts[0], verts[1], verts[2]])
    bm.faces.new([verts[0], verts[1], verts[3]])
    bm.faces.new([verts[0], verts[2], verts[3]])
    bm.faces.new([verts[1], verts[2], verts[3]])

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj
```

## 2.3 Procedural Grid Generation

```python
def create_procedural_grid(rows=10, cols=10, cell_size=1.0, name="ProceduralGrid"):
    obj, mesh = create_mesh_object(name)
    bm = bmesh.new()

    verts = []
    for r in range(rows + 1):
        row = []
        for c in range(cols + 1):
            v = bm.verts.new((c * cell_size, r * cell_size, 0.0))
            row.append(v)
        verts.append(row)

    bm.verts.ensure_lookup_table()

    for r in range(rows):
        for c in range(cols):
            bm.faces.new([
                verts[r][c],
                verts[r][c + 1],
                verts[r + 1][c + 1],
                verts[r + 1][c],
            ])

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj
```

## 2.4 Procedural Sine Wave Terrain

```python
def create_terrain(rows=30, cols=30, scale=0.5, amplitude=1.5, freq=0.5):
    obj, mesh = create_mesh_object("Terrain")
    bm = bmesh.new()

    verts = []
    for r in range(rows + 1):
        row = []
        for c in range(cols + 1):
            x = c * scale
            y = r * scale
            z = amplitude * math.sin(freq * x) * math.cos(freq * y)
            v = bm.verts.new((x, y, z))
            row.append(v)
        verts.append(row)

    bm.verts.ensure_lookup_table()

    for r in range(rows):
        for c in range(cols):
            bm.faces.new([
                verts[r][c],
                verts[r][c + 1],
                verts[r + 1][c + 1],
                verts[r + 1][c],
            ])

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj
```

## 2.5 BMesh Operations (bmesh.ops)

`bmesh.ops` provides high-level geometric operations on bmesh data:

```python
# Subdivide all faces
bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=2, use_grid_fill=True)

# Extrude faces and move
ret = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
extruded_verts = [v for v in ret['geom'] if isinstance(v, bmesh.types.BMVert)]
bmesh.ops.translate(bm, vec=Vector((0, 0, 1.0)), verts=extruded_verts)

# Convex hull from point cloud
bmesh.ops.convex_hull(bm, input=bm.verts)

# Remove doubles (merge by distance)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)

# Triangulate all faces
bmesh.ops.triangulate(bm, faces=bm.faces)

# Inset individual faces
bmesh.ops.inset_individual(bm, faces=bm.faces, thickness=0.1, depth=0.0)

# Bevel edges
bmesh.ops.bevel(bm, geom=bm.edges, offset=0.05, segments=2, affect='EDGES')

# Spin (lathe) around axis
bmesh.ops.spin(bm, geom=bm.verts[:] + bm.edges[:],
               angle=math.radians(360), steps=16,
               axis=Vector((0, 0, 1)), cent=Vector((0, 0, 0)))
```

## 2.6 Modifier Stack Engineering

Modifiers are non-destructive mesh operations applied at render/display time.

```python
def add_modifier(obj, mod_type, name=None, **props):
    name = name or mod_type.title()
    mod = obj.modifiers.new(name=name, type=mod_type)
    for key, val in props.items():
        try:
            setattr(mod, key, val)
        except AttributeError:
            pass  # Some props are nested (e.g. settings.*)
    return mod

# Subdivision Surface
def add_subsurf(obj, levels=2, render_levels=3, subdivision_type='CATMULL_CLARK'):
    mod = obj.modifiers.new("Subdivision", 'SUBSURF')
    mod.levels = levels
    mod.render_levels = render_levels
    mod.subdivision_type = subdivision_type
    return mod

# Solidify
def add_solidify(obj, thickness=0.05, offset=-1.0, fill_rim=True):
    mod = obj.modifiers.new("Solidify", 'SOLIDIFY')
    mod.thickness = thickness
    mod.offset = offset
    mod.use_rim = fill_rim
    return mod

# Array
def add_array(obj, count=4, offset_x=2.0, offset_y=0.0, offset_z=0.0):
    mod = obj.modifiers.new("Array", 'ARRAY')
    mod.count = count
    mod.use_relative_offset = True
    mod.relative_offset_displace = (offset_x, offset_y, offset_z)
    return mod

# Mirror
def add_mirror(obj, use_x=True, use_y=False, use_z=False, merge=True):
    mod = obj.modifiers.new("Mirror", 'MIRROR')
    mod.use_axis[0] = use_x
    mod.use_axis[1] = use_y
    mod.use_axis[2] = use_z
    mod.use_mirror_merge = merge
    return mod

# Bevel
def add_bevel(obj, width=0.05, segments=2, limit_method='NONE'):
    mod = obj.modifiers.new("Bevel", 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = limit_method
    return mod

# Boolean
def add_boolean(target, cutter, operation='DIFFERENCE', solver='FAST'):
    mod = target.modifiers.new("Boolean", 'BOOLEAN')
    mod.operation = operation
    mod.object = cutter
    mod.solver = solver
    cutter.display_type = 'WIRE'
    cutter.hide_render = True
    return mod

# Displace
def add_displace(obj, texture_name="DispTex", strength=0.5, texture_type='CLOUDS'):
    tex = bpy.data.textures.new(texture_name, type=texture_type)
    tex.noise_scale = 0.5
    mod = obj.modifiers.new("Displace", 'DISPLACE')
    mod.texture = tex
    mod.strength = strength
    return mod

# Decimate
def add_decimate(obj, ratio=0.5):
    mod = obj.modifiers.new("Decimate", 'DECIMATE')
    mod.ratio = ratio
    return mod

# Apply all modifiers (destructive)
def apply_all_modifiers(obj):
    set_active(obj)
    ensure_mode('OBJECT')
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
```

## 2.7 Geometry Nodes via Python (Blender 4.x)

```python
def setup_geometry_nodes(obj, group_name="GeoNodes"):
    mod = obj.modifiers.new("GeometryNodes", 'NODES')
    ng = bpy.data.node_groups.new(group_name, 'GeometryNodeTree')
    mod.node_group = ng

    nodes = ng.nodes
    links = ng.links

    # Interface sockets (Blender 4.x API)
    ng.interface.new_socket('Geometry', in_out='INPUT',  socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')

    in_node  = nodes.new('NodeGroupInput');  in_node.location  = (-400, 0)
    out_node = nodes.new('NodeGroupOutput'); out_node.location = (400, 0)

    # Example: Subdivide + Set Position with noise
    subdiv = nodes.new('GeometryNodeSubdivideMesh')
    subdiv.location = (-100, 50)
    subdiv.inputs['Level'].default_value = 3

    noise = nodes.new('ShaderNodeTexNoise')
    noise.location = (-300, -150)
    noise.inputs['Scale'].default_value = 3.0

    set_pos = nodes.new('GeometryNodeSetPosition')
    set_pos.location = (150, 0)

    links.new(in_node.outputs[0],      subdiv.inputs['Mesh'])
    links.new(subdiv.outputs['Mesh'],  set_pos.inputs['Geometry'])
    links.new(noise.outputs['Color'],  set_pos.inputs['Offset'])
    links.new(set_pos.outputs['Geometry'], out_node.inputs[0])

    return mod
```

## 2.8 Sculpting Helpers via Python

```python
def enable_dyntopo(obj, detail_size=5.0, method='RELATIVE'):
    set_active(obj)
    bpy.ops.object.mode_set(mode='SCULPT')
    scene = bpy.context.scene
    if not bpy.context.sculpt_object.use_dynamic_topology_sculpting:
        bpy.ops.sculpt.dynamic_topology_toggle()
    scene.tool_settings.sculpt.detail_size = detail_size
    scene.tool_settings.sculpt.detail_type_method = method

def smooth_mesh_bmesh(obj, iterations=10, factor=0.5):
    """Non-sculpt laplacian smoothing via bmesh — safe for scripting."""
    ensure_mode('OBJECT')
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()

    for _ in range(iterations):
        for v in bm.verts:
            if v.is_boundary:
                continue
            neighbors = [e.other_vert(v).co.copy() for e in v.link_edges]
            if neighbors:
                avg = sum(neighbors, Vector()) / len(neighbors)
                v.co = v.co.lerp(avg, factor)

    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

def add_multires(obj, levels=3):
    mod = obj.modifiers.new("Multires", 'MULTIRES')
    set_active(obj)
    for _ in range(levels):
        bpy.ops.object.multires_subdivide(modifier="Multires", mode='CATMULL_CLARK')
    return mod
```

---

# SECTION 3: Complex Object Construction — Soccer Ball

## 3.1 Mathematical Foundation

A soccer ball is a **truncated icosahedron**: a convex polyhedron with:
- **12 regular pentagons** (black panels)
- **20 regular hexagons** (white panels)
- **60 vertices**, **90 edges**

The vertices are derived from cyclic permutations of three coordinate families based on the **golden ratio φ = (1 + √5) / 2**.

## 3.2 Complete Soccer Ball Script

```python
import bpy
import bmesh
import math
from mathutils import Vector

def create_soccer_ball(radius=1.0, name="SoccerBall"):
    """
    Procedurally constructs a truncated icosahedron (soccer ball).
    Uses convex hull of mathematically derived vertices,
    then colors pentagons black and hexagons white.
    """
    phi = (1 + math.sqrt(5)) / 2

    raw_verts = set()

    def add_perms(a, b, c):
        for s1 in [1, -1]:
            for s2 in [1, -1]:
                raw_verts.add((     0, s1*a, s2*b))
                raw_verts.add((s1*a,      0, s2*b))
                raw_verts.add((s1*a,  s2*b,     0))
        for s1 in [1, -1]:
            for s2 in [1, -1]:
                for s3 in [1, -1]:
                    raw_verts.add((s1*b, s2*c, s3*a))
                    raw_verts.add((s1*c, s2*a, s3*b))
                    raw_verts.add((s1*a, s2*b, s3*c))

    # Three families of coordinates for truncated icosahedron
    add_perms(1, 3*phi, 0)
    add_perms(2, 1 + 2*phi, phi)
    add_perms(1, 2 + phi, 2*phi)

    # Normalize all vertices to the sphere surface
    norm_verts = []
    for rv in raw_verts:
        v = Vector(rv)
        if v.length > 1e-6:
            norm_verts.append((v / v.length) * radius)

    # Remove near-duplicates
    unique_verts = []
    for v in norm_verts:
        if not any((v - u).length < 1e-4 for u in unique_verts):
            unique_verts.append(v)

    # Build mesh via convex hull
    mesh = bpy.data.meshes.new(name)
    obj  = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    for v in unique_verts:
        bm.verts.new(v)
    bm.verts.ensure_lookup_table()

    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    _color_panels(obj)
    return obj


def _color_panels(obj):
    """Assign black to pentagons, white to hexagons."""
    mat_white = bpy.data.materials.new("Panel_White")
    mat_white.use_nodes = True
    mat_white.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.95, 0.95, 0.95, 1)

    mat_black = bpy.data.materials.new("Panel_Black")
    mat_black.use_nodes = True
    mat_black.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)

    obj.data.materials.append(mat_white)  # index 0
    obj.data.materials.append(mat_black)  # index 1

    for poly in obj.data.polygons:
        poly.material_index = 1 if len(poly.vertices) == 5 else 0

    obj.data.update()


def add_soccer_ball_detail(obj):
    """Add seam geometry with Bevel + Subdivision."""
    bev = obj.modifiers.new("Bevel", 'BEVEL')
    bev.width = 0.015
    bev.segments = 3
    bev.limit_method = 'NONE'

    sub = obj.modifiers.new("Subdivision", 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 3
    sub.subdivision_type = 'CATMULL_CLARK'

    # Smooth shading
    for poly in obj.data.polygons:
        poly.use_smooth = True
    obj.data.update()


# --- Run ---
ball = create_soccer_ball(radius=1.0)
add_soccer_ball_detail(ball)
```

## 3.3 Hex/Pentagon UV Layout for Texturing

```python
def unwrap_soccer_ball(obj):
    set_active(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(66),
        island_margin=0.03,
        area_weight=0.0,
        correct_aspect=True,
        scale_to_bounds=True
    )
    bpy.ops.object.mode_set(mode='OBJECT')
```

---

# SECTION 4: Material Engineering

## 4.1 Node Material Foundation

```python
def new_node_material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    return mat, mat.node_tree.nodes, mat.node_tree.links

def output_node(nodes, location=(600, 0)):
    n = nodes.new('ShaderNodeOutputMaterial')
    n.location = location
    return n

def principled_node(nodes, location=(200, 0)):
    n = nodes.new('ShaderNodeBsdfPrincipled')
    n.location = location
    return n

def assign_material(obj, mat):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
```

## 4.2 PBR Material (Principled BSDF)

```python
def build_pbr_material(name="PBR",
                        base_color=(0.8, 0.8, 0.8, 1.0),
                        metallic=0.0,
                        roughness=0.4,
                        ior=1.45,
                        alpha=1.0,
                        emit_color=None,
                        emit_strength=0.0):
    mat, nodes, links = new_node_material(name)
    out  = output_node(nodes, (500, 0))
    bsdf = principled_node(nodes, (0, 0))

    bsdf.inputs['Base Color'].default_value  = base_color
    bsdf.inputs['Metallic'].default_value    = metallic
    bsdf.inputs['Roughness'].default_value   = roughness
    bsdf.inputs['IOR'].default_value         = ior
    bsdf.inputs['Alpha'].default_value       = alpha

    if emit_color:
        bsdf.inputs['Emission Color'].default_value    = emit_color
        bsdf.inputs['Emission Strength'].default_value = emit_strength

    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat
```

## 4.3 Procedural Noise Material

```python
def build_noise_material(name="NoiseMat", scale=5.0, detail=8.0,
                          col_a=(0.05, 0.02, 0.01, 1),
                          col_b=(0.9, 0.85, 0.7, 1)):
    mat, nodes, links = new_node_material(name)
    out   = output_node(nodes, (800, 0))
    bsdf  = principled_node(nodes, (400, 0))
    ramp  = nodes.new('ShaderNodeValToRGB');  ramp.location  = (100, 0)
    noise = nodes.new('ShaderNodeTexNoise');  noise.location = (-200, 0)
    coord = nodes.new('ShaderNodeTexCoord');  coord.location = (-500, 0)

    noise.inputs['Scale'].default_value  = scale
    noise.inputs['Detail'].default_value = detail

    ramp.color_ramp.elements[0].color = col_a
    ramp.color_ramp.elements[1].color = col_b

    links.new(coord.outputs['Generated'], noise.inputs['Vector'])
    links.new(noise.outputs['Fac'],       ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'],      bsdf.inputs['Base Color'])
    links.new(bsdf.outputs['BSDF'],       out.inputs['Surface'])
    return mat
```

## 4.4 Glass / Transparent Material

```python
def build_glass_material(name="Glass", color=(0.8, 0.95, 1.0, 1.0), ior=1.45, roughness=0.0):
    mat, nodes, links = new_node_material(name)
    mat.blend_method = 'BLEND'
    out   = output_node(nodes, (400, 0))
    glass = nodes.new('ShaderNodeBsdfGlass')
    glass.location = (0, 0)
    glass.inputs['Color'].default_value     = color
    glass.inputs['IOR'].default_value       = ior
    glass.inputs['Roughness'].default_value = roughness
    links.new(glass.outputs['BSDF'], out.inputs['Surface'])
    return mat
```

## 4.5 Layered Mix Material

```python
def build_mixed_material(name="MixMat", mat_a_color=(1,0,0,1), mat_b_color=(0,0,1,1)):
    mat, nodes, links = new_node_material(name)
    out    = output_node(nodes, (700, 0))
    mix    = nodes.new('ShaderNodeMixShader'); mix.location = (400, 0)
    bsdf_a = nodes.new('ShaderNodeBsdfPrincipled'); bsdf_a.location = (0, 100)
    bsdf_b = nodes.new('ShaderNodeBsdfPrincipled'); bsdf_b.location = (0, -150)
    fac    = nodes.new('ShaderNodeFresnel');   fac.location = (200, 150)

    bsdf_a.inputs['Base Color'].default_value = mat_a_color
    bsdf_b.inputs['Base Color'].default_value = mat_b_color

    links.new(fac.outputs['Fac'],       mix.inputs['Fac'])
    links.new(bsdf_a.outputs['BSDF'],   mix.inputs[1])
    links.new(bsdf_b.outputs['BSDF'],   mix.inputs[2])
    links.new(mix.outputs['Shader'],    out.inputs['Surface'])
    return mat
```

## 4.6 UV Unwrapping

```python
def smart_uv_unwrap(obj, angle_limit=66.0, margin=0.02):
    set_active(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(angle_limit),
        island_margin=margin,
        correct_aspect=True,
        scale_to_bounds=False
    )
    bpy.ops.object.mode_set(mode='OBJECT')

def unwrap_seam_based(obj):
    """Mark seams manually then unwrap."""
    set_active(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.mark_seam(clear=False)  # Marks sharp edges as seams
    bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

def add_uv_layer(obj, name="UVMap"):
    if name not in obj.data.uv_layers:
        obj.data.uv_layers.new(name=name)
    obj.data.uv_layers.active = obj.data.uv_layers[name]
```

## 4.7 Texture Baking

```python
def bake_to_image(obj, bake_type='DIFFUSE', resolution=1024, filepath="/tmp/baked.png"):
    """
    Bakes the active material to an image texture.
    bake_type options: 'COMBINED', 'DIFFUSE', 'ROUGHNESS', 'NORMAL', 'SHADOW', 'AO'
    """
    # Requires Cycles render engine
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 64

    img = bpy.data.images.new("BakedTex", width=resolution, height=resolution, alpha=True)
    img.filepath_raw = filepath
    img.file_format = 'PNG'

    mat = obj.active_material
    if not mat or not mat.use_nodes:
        raise ValueError("Object needs an active node material for baking.")

    # Add Image Texture node, make it active (bake target)
    img_node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    img_node.location = (-400, -400)
    img_node.image = img
    mat.node_tree.nodes.active = img_node

    # Bake settings
    bake = bpy.context.scene.render.bake
    bake.use_pass_direct   = False
    bake.use_pass_indirect = False
    bake.use_pass_color    = True

    set_active(obj)
    bpy.ops.object.bake(type=bake_type)
    img.save_render(filepath)
    print(f"[BAKE] Saved to {filepath}")
    return img
```

---

# SECTION 5: Advanced Animation

## 5.1 Keyframe Insertion

```python
def animate_location(obj, keyframes):
    """keyframes: list of (frame, x, y, z)"""
    for frame, x, y, z in keyframes:
        obj.location = (x, y, z)
        obj.keyframe_insert(data_path="location", frame=frame)

def animate_rotation_euler(obj, keyframes):
    """keyframes: list of (frame, rx_deg, ry_deg, rz_deg)"""
    obj.rotation_mode = 'XYZ'
    for frame, rx, ry, rz in keyframes:
        obj.rotation_euler = (math.radians(rx), math.radians(ry), math.radians(rz))
        obj.keyframe_insert(data_path="rotation_euler", frame=frame)

def animate_scale(obj, keyframes):
    """keyframes: list of (frame, sx, sy, sz)"""
    for frame, sx, sy, sz in keyframes:
        obj.scale = (sx, sy, sz)
        obj.keyframe_insert(data_path="scale", frame=frame)

def set_fcurve_interpolation(obj, data_path='location', mode='BEZIER'):
    """mode: 'BEZIER', 'LINEAR', 'CONSTANT'"""
    if obj.animation_data and obj.animation_data.action:
        for fc in obj.animation_data.action.fcurves:
            if fc.data_path.startswith(data_path):
                for kp in fc.keyframe_points:
                    kp.interpolation = mode
```

## 5.2 Armature & Bone Setup

```python
def create_armature(name="Armature", location=(0, 0, 0)):
    arm_data = bpy.data.armatures.new(name)
    arm_obj  = bpy.data.objects.new(name, arm_data)
    arm_obj.location = location
    bpy.context.collection.objects.link(arm_obj)
    set_active(arm_obj)
    bpy.ops.object.mode_set(mode='EDIT')
    return arm_obj, arm_data

def add_bone(arm_data, name, head, tail, parent_name=None, connected=False):
    """Must be in EDIT mode."""
    bone = arm_data.edit_bones.new(name)
    bone.head = Vector(head)
    bone.tail = Vector(tail)
    if parent_name:
        parent = arm_data.edit_bones.get(parent_name)
        if parent:
            bone.parent = parent
            bone.use_connect = connected
    return bone

def add_bone_chain(arm_data, prefix="Bone", count=4,
                   start=(0,0,0), direction=(0,0,1), length=0.5):
    prev = None
    for i in range(count):
        head = Vector(start) + Vector(direction) * length * i
        tail = head + Vector(direction) * length
        bone = add_bone(arm_data, f"{prefix}.{i:03d}", head, tail,
                        parent_name=prev, connected=(i > 0))
        prev = bone.name
    return prev  # name of last bone

def finalize_armature_edit():
    bpy.ops.object.mode_set(mode='OBJECT')

def parent_with_auto_weights(mesh_obj, arm_obj):
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
```

## 5.3 Pose Bone Constraints

```python
def get_pose_bone(arm_obj, bone_name):
    return arm_obj.pose.bones.get(bone_name)

def add_ik_constraint(arm_obj, bone_name, target_obj=None,
                       subtarget="", chain_count=3):
    pb = get_pose_bone(arm_obj, bone_name)
    if not pb:
        raise ValueError(f"Pose bone '{bone_name}' not found.")
    con = pb.constraints.new('IK')
    con.chain_count = chain_count
    if target_obj:
        con.target = target_obj
        con.subtarget = subtarget
    return con

def add_copy_rotation(arm_obj, bone_name, target_obj, subtarget="", influence=1.0):
    pb = get_pose_bone(arm_obj, bone_name)
    con = pb.constraints.new('COPY_ROTATION')
    con.target     = target_obj
    con.subtarget  = subtarget
    con.influence  = influence
    return con

def add_stretch_to(arm_obj, bone_name, target_obj, subtarget=""):
    pb = get_pose_bone(arm_obj, bone_name)
    con = pb.constraints.new('STRETCH_TO')
    con.target    = target_obj
    con.subtarget = subtarget
    return con

def add_limit_rotation(arm_obj, bone_name,
                        use_x=True, min_x=-90, max_x=90,
                        use_y=False, min_y=0, max_y=0,
                        use_z=False, min_z=0, max_z=0):
    pb = get_pose_bone(arm_obj, bone_name)
    con = pb.constraints.new('LIMIT_ROTATION')
    con.owner_space = 'LOCAL'
    con.use_x = use_x; con.min_x = math.radians(min_x); con.max_x = math.radians(max_x)
    con.use_y = use_y; con.min_y = math.radians(min_y); con.max_y = math.radians(max_y)
    con.use_z = use_z; con.min_z = math.radians(min_z); con.max_z = math.radians(max_z)
    return con
```

## 5.4 Object-Level Constraints

```python
def add_track_to(obj, target, track_axis='TRACK_NEGATIVE_Z', up_axis='UP_Y'):
    con = obj.constraints.new('TRACK_TO')
    con.target     = target
    con.track_axis = track_axis
    con.up_axis    = up_axis
    return con

def add_copy_location(obj, target, use_offset=False):
    con = obj.constraints.new('COPY_LOCATION')
    con.target     = target
    con.use_offset = use_offset
    return con

def add_follow_path(obj, curve_obj, use_fixed_location=False, offset_factor=0.0):
    con = obj.constraints.new('FOLLOW_PATH')
    con.target              = curve_obj
    con.use_fixed_location  = use_fixed_location
    con.offset_factor       = offset_factor
    con.use_curve_follow    = True
    bpy.ops.object.select_all(action='DESELECT')
    set_active(curve_obj)
    bpy.ops.object.paths_calculate(start_frame=1, end_frame=250)
    return con

def add_floor_constraint(obj, target, offset=0.0):
    con = obj.constraints.new('FLOOR')
    con.target         = target
    con.offset         = offset
    con.floor_location = 'FLOOR_Z'
    return con
```

## 5.5 Drivers

```python
def add_scripted_driver(target_obj, target_path, target_index,
                         source_obj, source_path, expression="var"):
    """
    Drive a property on target_obj using a property from source_obj.

    Example: drive cube.location[2] using empty.rotation_euler[0]
        add_scripted_driver(cube, "location", 2,
                            empty, "rotation_euler[0]", "var * 3")
    """
    fc = target_obj.driver_add(target_path, target_index)
    drv = fc.driver
    drv.type = 'SCRIPTED'
    drv.expression = expression

    var = drv.variables.new()
    var.name = "var"
    var.type = 'SINGLE_PROP'
    var.targets[0].id        = source_obj
    var.targets[0].data_path = source_path
    return drv

def add_transform_driver(target_obj, target_path, target_index,
                          source_obj, transform_type='LOC_X',
                          space='WORLD_SPACE', expression="var"):
    """Drive using a transform channel (location, rotation, scale)."""
    fc = target_obj.driver_add(target_path, target_index)
    drv = fc.driver
    drv.type = 'SCRIPTED'
    drv.expression = expression

    var = drv.variables.new()
    var.name = "var"
    var.type = 'TRANSFORMS'
    var.targets[0].id             = source_obj
    var.targets[0].transform_type = transform_type
    var.targets[0].transform_space = space
    return drv
```

## 5.6 Shape Keys

```python
def add_shape_key_basis(obj):
    return obj.shape_key_add(name="Basis", from_mix=False)

def add_shape_key(obj, name, vert_offsets=None):
    """
    vert_offsets: dict of {vert_index: Vector(dx, dy, dz)} or None.
    If None, shape key is created with no offset (edit manually or via code).
    """
    if not obj.data.shape_keys:
        add_shape_key_basis(obj)
    key = obj.shape_key_add(name=name, from_mix=False)
    if vert_offsets:
        for idx, offset in vert_offsets.items():
            key.data[idx].co += Vector(offset)
    return key

def animate_shape_key(obj, key_name, keyframes):
    """keyframes: list of (frame, value)"""
    sk = obj.data.shape_keys
    kb = sk.key_blocks.get(key_name)
    if not kb:
        raise ValueError(f"Shape key '{key_name}' not found.")
    for frame, val in keyframes:
        kb.value = val
        kb.keyframe_insert(data_path="value", frame=frame)
```

## 5.7 Physics Simulations

```python
# --- Rigid Body ---
def add_rigid_body(obj, body_type='ACTIVE', shape='CONVEX_HULL',
                   mass=1.0, friction=0.5, restitution=0.2):
    set_active(obj)
    obj.select_set(True)
    bpy.ops.rigidbody.object_add()
    rb = obj.rigid_body
    rb.type              = body_type    # 'ACTIVE' or 'PASSIVE'
    rb.collision_shape   = shape        # 'BOX', 'SPHERE', 'CONVEX_HULL', 'MESH'
    rb.mass              = mass
    rb.friction          = friction
    rb.restitution       = restitution
    return rb

# --- Cloth ---
def add_cloth(obj, quality=10, mass=0.3, tension=15.0, self_collision=True):
    mod = obj.modifiers.new("Cloth", 'CLOTH')
    s = mod.settings
    s.quality              = quality
    s.mass                 = mass
    s.tension_stiffness    = tension
    s.compression_stiffness = tension
    mod.collision_settings.use_self_collision = self_collision
    return mod

# --- Soft Body ---
def add_soft_body(obj, goal_strength=0.5, use_edges=True):
    mod = obj.modifiers.new("Softbody", 'SOFT_BODY')
    mod.settings.use_goal        = True
    mod.settings.goal_default    = goal_strength
    mod.settings.use_edges       = use_edges
    return mod

# --- Particle System ---
def add_particle_system(obj, count=1000, lifetime=100,
                         emit_from='FACE', physics_type='NEWTON'):
    mod = obj.modifiers.new("Particles", 'PARTICLE_SYSTEM')
    ps  = mod.particle_system.settings
    ps.count        = count
    ps.lifetime     = lifetime
    ps.emit_from    = emit_from
    ps.physics_type = physics_type
    return mod

# --- Fluid (Mantaflow) ---
def add_fluid_domain(obj, resolution=64, domain_type='LIQUID'):
    mod = obj.modifiers.new("Fluid", 'FLUID')
    mod.fluid_type = 'DOMAIN'
    mod.domain_settings.domain_type   = domain_type
    mod.domain_settings.resolution_max = resolution
    return mod

def add_fluid_flow(obj, flow_type='LIQUID', behavior='GEOMETRY'):
    mod = obj.modifiers.new("Fluid", 'FLUID')
    mod.fluid_type = 'FLOW'
    mod.flow_settings.flow_type     = flow_type
    mod.flow_settings.flow_behavior = behavior
    return mod

# --- Bake All Physics ---
def bake_all_physics():
    bpy.ops.ptcache.bake_all(bake=True)
```

## 5.8 NLA (Non-Linear Animation)

```python
def push_action_to_nla(obj, track_name="Track"):
    if not obj.animation_data:
        obj.animation_data_create()
    ad = obj.animation_data
    if ad.action:
        track = ad.nla_tracks.new()
        track.name = track_name
        start = int(ad.action.frame_range[0])
        track.strips.new(ad.action.name, start, ad.action)
        ad.action = None  # Detach action so NLA controls it

def add_nla_strip(obj, action, track_name="NLATrack", start_frame=1,
                   scale=1.0, repeat=1.0):
    if not obj.animation_data:
        obj.animation_data_create()
    track = obj.animation_data.nla_tracks.new()
    track.name = track_name
    strip = track.strips.new(action.name, start_frame, action)
    strip.scale  = scale
    strip.repeat = repeat
    return strip

def blend_nla_strips(obj, influence=0.5, blend_type='REPLACE'):
    """Set blend mode on all NLA strips."""
    if not obj.animation_data:
        return
    for track in obj.animation_data.nla_tracks:
        for strip in track.strips:
            strip.blend_type     = blend_type
            strip.influence      = influence
```

---

# SECTION 6: Automation Patterns

## 6.1 Custom Operator Template

```python
import bpy

class OBJECT_OT_ProcSoccerBall(bpy.types.Operator):
    """Procedurally generate a soccer ball"""
    bl_idname  = "object.proc_soccer_ball"
    bl_label   = "Create Soccer Ball"
    bl_options = {'REGISTER', 'UNDO'}

    radius: bpy.props.FloatProperty(
        name="Radius", default=1.0, min=0.01, max=100.0)
    add_detail: bpy.props.BoolProperty(
        name="Add Seam Detail", default=True)

    def execute(self, context):
        try:
            obj = create_soccer_ball(self.radius)
            if self.add_detail:
                add_soccer_ball_detail(obj)
            context.view_layer.objects.active = obj
            obj.select_set(True)
            self.report({'INFO'}, f"Created: {obj.name}")
            return {'FINISHED'}
        except Exception as e:
            self.report({'ERROR'}, f"Failed: {e}")
            return {'CANCELLED'}

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)


class VIEW3D_PT_ProceduralTools(bpy.types.Panel):
    bl_label      = "Procedural Tools"
    bl_idname     = "VIEW3D_PT_proc_tools"
    bl_space_type = 'VIEW_3D'
    bl_region_type= 'UI'
    bl_category   = "ProceduralTools"

    def draw(self, context):
        layout = self.layout
        layout.label(text="Objects:")
        layout.operator("object.proc_soccer_ball", icon='MESH_UVSPHERE')


def register():
    bpy.utils.register_class(OBJECT_OT_ProcSoccerBall)
    bpy.utils.register_class(VIEW3D_PT_ProceduralTools)

def unregister():
    bpy.utils.unregister_class(VIEW3D_PT_ProceduralTools)
    bpy.utils.unregister_class(OBJECT_OT_ProcSoccerBall)

if __name__ == "__main__":
    register()
```

## 6.2 Reusable Utility Module

```python
# ============================================================
# blender_utils.py — Core utilities for MCP-driven scripting
# ============================================================

import bpy, bmesh, mathutils, math, traceback
from mathutils import Vector

# --- Scene Management ---

def clear_scene(keep_camera=True, keep_light=True):
    protected_types = set()
    if keep_camera: protected_types.add('CAMERA')
    if keep_light:  protected_types.add('LIGHT')
    for obj in list(bpy.context.scene.objects):
        if obj.type not in protected_types:
            bpy.data.objects.remove(obj, do_unlink=True)
    for block in list(bpy.data.meshes):     bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):  bpy.data.materials.remove(block)
    for block in list(bpy.data.curves):     bpy.data.curves.remove(block)

def safe_get_obj(name: str):
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise KeyError(f"Object not found: '{name}'")
    return obj

def safe_delete_obj(name: str):
    obj = bpy.data.objects.get(name)
    if obj:
        bpy.data.objects.remove(obj, do_unlink=True)

def duplicate_obj(obj, name=None, linked=False):
    new_obj = obj.copy()
    new_obj.data = obj.data if linked else obj.data.copy()
    if name: new_obj.name = name
    bpy.context.collection.objects.link(new_obj)
    return new_obj

# --- Collections ---

def get_or_create_collection(name: str):
    col = bpy.data.collections.get(name)
    if not col:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col

def move_obj_to_collection(obj, col_name: str):
    col = get_or_create_collection(col_name)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)

# --- Transforms ---

def set_transform(obj, loc=(0,0,0), rot_deg=(0,0,0), scale=(1,1,1)):
    obj.location      = loc
    obj.rotation_euler = tuple(math.radians(r) for r in rot_deg)
    obj.scale          = scale

def apply_transform(obj, location=False, rotation=True, scale=True):
    set_active(obj)
    ensure_mode('OBJECT')
    bpy.ops.object.transform_apply(location=location, rotation=rotation, scale=scale)

# --- Viewport Display ---

def set_display(obj, display_type='SOLID', show_wire=False, show_bounds=False):
    obj.display_type       = display_type
    obj.show_wire          = show_wire
    obj.show_bounds        = show_bounds

def hide_obj(obj, hide=True, render=True):
    obj.hide_viewport = hide
    obj.hide_render   = render

# --- Error Handling Wrapper ---

def safe_exec(func, *args, label="", **kwargs):
    """
    Safely execute a Blender scripting function.
    Returns (result, None) on success, (None, error_str) on failure.
    """
    try:
        return func(*args, **kwargs), None
    except Exception as e:
        msg = f"[ERROR]{' ' + label if label else ''}: {type(e).__name__}: {e}\n{traceback.format_exc()}"
        print(msg)
        return None, msg
```

## 6.3 Batch Processing Patterns

```python
def batch_apply_material(mat_name: str, obj_type='MESH', collection=None):
    mat = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
    objs = collection.objects if collection else bpy.context.scene.objects
    for obj in objs:
        if obj.type == obj_type:
            if obj.data.materials:
                obj.data.materials[0] = mat
            else:
                obj.data.materials.append(mat)

def batch_rename(prefix="obj", collection=None):
    objs = list((collection.objects if collection else bpy.context.scene.objects))
    for i, obj in enumerate(objs):
        obj.name = f"{prefix}_{i:04d}"

def batch_export_fbx(output_dir: str):
    import os
    os.makedirs(output_dir, exist_ok=True)
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        path = os.path.join(output_dir, f"{obj.name}.fbx")
        bpy.ops.export_scene.fbx(
            filepath=path,
            use_selection=True,
            apply_unit_scale=True,
            bake_anim=True,
            global_scale=1.0
        )
        print(f"[EXPORT] {path}")

def batch_snapshot():
    return {
        obj.name: {
            'loc':   tuple(obj.location),
            'rot':   tuple(obj.rotation_euler),
            'scale': tuple(obj.scale),
            'hide':  obj.hide_viewport,
        }
        for obj in bpy.context.scene.objects
    }

def batch_restore(snapshot: dict):
    for name, s in snapshot.items():
        obj = bpy.data.objects.get(name)
        if obj:
            obj.location        = s['loc']
            obj.rotation_euler  = s['rot']
            obj.scale           = s['scale']
            obj.hide_viewport   = s['hide']
```

## 6.4 Custom Properties & Property Groups

```python
import bpy

class SoccerBallProps(bpy.types.PropertyGroup):
    radius:      bpy.props.FloatProperty(name="Radius",      default=1.0, min=0.01)
    add_seams:   bpy.props.BoolProperty(name="Add Seams",    default=True)
    bevel_width: bpy.props.FloatProperty(name="Bevel Width", default=0.015, min=0.0)
    panel_color: bpy.props.FloatVectorProperty(
                    name="Black Panel Color", subtype='COLOR',
                    default=(0.02, 0.02, 0.02), size=3)

def register_props():
    bpy.utils.register_class(SoccerBallProps)
    bpy.types.Scene.soccer_ball_props = bpy.props.PointerProperty(type=SoccerBallProps)

def unregister_props():
    del bpy.types.Scene.soccer_ball_props
    bpy.utils.unregister_class(SoccerBallProps)

# Access in operator:
# props = context.scene.soccer_ball_props
# obj = create_soccer_ball(props.radius)
```

## 6.5 LLM Script Generation Guidelines for MCP

When prompting a local LLM to generate Blender Python scripts via MCP, follow these rules:

### Prompt Structure
Always provide the LLM with:
1. **Blender version** — "Target Blender 4.x, Python 3.11"
2. **Goal** — exact object, material, or animation to create
3. **Context** — scene state (empty vs. existing objects), collection name
4. **Constraints** — avoid bpy.ops where possible; prefer bmesh + bpy.data

### Script Output Rules for LLM
- Every script must start with `import bpy` and all other required imports
- Every script must wrap logic in a `main()` function with try/except
- Every script must call `bpy.context.view_layer.update()` at the end
- Never hardcode object names that may conflict; always use `bpy.data.objects.get()` defensively
- Never call `bpy.ops.*` inside loops (operator overhead is high; use bmesh or data API instead)
- Always call `bm.free()` after `bm.to_mesh()` to prevent memory leaks
- Always call `mesh.update()` after writing to a mesh

### Common Failure Patterns to Avoid
| Anti-Pattern | Correct Approach |
|---|---|
| `bpy.ops.mesh.*` inside a loop | Use `bmesh` API instead |
| Hardcoded `bpy.data.objects["Cube"]` | Use `.get("Cube")` and null-check |
| Forgetting `bm.free()` | Always free after `to_mesh()` |
| Using `bpy.ops` without context override | Use `bpy.data` + direct API |
| Not calling `ensure_lookup_table()` | Call after every bulk vert/edge/face add |
| Mixing EDIT and OBJECT mode calls | Always explicitly set mode before operating |

### MCP Prompt Template for LLM
```
You are a Blender Python API expert. Generate a complete, executable Python script
for Blender 4.x that performs the following task:

TASK: [describe object/animation/material]

Requirements:
- Use bpy, bmesh, mathutils as needed
- Wrap all logic in main() with try/except error handling
- Avoid bpy.ops inside loops
- Always free bmesh instances after use
- Print [SUCCESS] or [ERROR] messages for MCP result parsing
- End with: if __name__ == "__main__": main()
```

---

# APPENDIX: Quick Reference — Key bpy Namespaces

| Namespace | Purpose | Example |
|---|---|---|
| `bpy.data.objects` | All objects in blend file | `bpy.data.objects.get("Cube")` |
| `bpy.data.meshes` | All mesh data blocks | `bpy.data.meshes.new("MyMesh")` |
| `bpy.data.materials` | All materials | `bpy.data.materials.new("Mat")` |
| `bpy.data.actions` | All animation actions | `bpy.data.actions.get("Run")` |
| `bpy.data.armatures` | All armature data | `bpy.data.armatures.new("Rig")` |
| `bpy.data.node_groups` | Geometry/shader node groups | `bpy.data.node_groups.new(...)` |
| `bpy.context.scene` | Active scene | `bpy.context.scene.frame_current` |
| `bpy.context.view_layer` | Active view layer | `bpy.context.view_layer.update()` |
| `bpy.context.object` | Currently active object | `bpy.context.object.name` |
| `bpy.ops.object.*` | Object-level operators | `bpy.ops.object.mode_set(...)` |
| `bpy.ops.mesh.*` | Mesh edit operators | `bpy.ops.mesh.select_all(...)` |
| `bmesh.new()` | Create in-memory mesh | `bm = bmesh.new()` |
| `bmesh.ops.*` | Geometric operations | `bmesh.ops.convex_hull(bm, ...)` |
| `mathutils.Vector` | 3D vector math | `Vector((1, 0, 0))` |
| `mathutils.Matrix` | Transformation matrices | `Matrix.Rotation(...)` |
| `mathutils.Euler` | Euler rotations | `Euler((0, 0, math.pi), 'XYZ')` |

---

*Document Version: 1.0 — Advanced Blender Python API & MCP Reference*
*Covers: Blender 4.x | Python 3.11+ | bmesh | Geometry Nodes | Physics | NLA | MCP Integration*
