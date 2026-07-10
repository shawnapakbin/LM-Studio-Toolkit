/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Python code generator for performance metrics collection.
 * Produces code that gathers memory usage, scene complexity,
 * and GPU information from the running Blender instance.
 *
 * Requirement 7: Performance Metrics Tool
 */

/**
 * Generates Python code that collects performance metrics.
 * The generated code:
 * - Reports system memory usage (used + total) in MB
 * - Counts all scene objects (including hidden)
 * - Sums polygon and vertex counts across all mesh objects
 * - Counts unique materials in use
 * - Reports GPU device info when available
 *
 * @returns Generated Python code string
 */
export function generatePerformanceMetricsCode(): string {
  return `import bpy
import json
import sys

# Memory usage
memory_used_mb = 0
memory_total_mb = 0

try:
    import psutil
    process = psutil.Process()
    memory_used_mb = int(process.memory_info().rss / (1024 * 1024))
    memory_total_mb = int(psutil.virtual_memory().total / (1024 * 1024))
except ImportError:
    try:
        import resource
        # resource module (Unix only)
        usage = resource.getrusage(resource.RUSAGE_SELF)
        memory_used_mb = int(usage.ru_maxrss / 1024)  # on Linux it's in KB
        import os
        if sys.platform == 'darwin':
            memory_used_mb = int(usage.ru_maxrss / (1024 * 1024))  # macOS uses bytes
        # Approximate total from os
        memory_total_mb = 0
    except:
        memory_used_mb = 0
        memory_total_mb = 0

# Scene complexity
scene = bpy.context.scene
object_count = len(scene.objects)
polygon_count = 0
vertex_count = 0
materials = set()

for obj in scene.objects:
    if obj.type == 'MESH' and obj.data:
        mesh = obj.data
        polygon_count += len(mesh.polygons)
        vertex_count += len(mesh.vertices)
        for mat_slot in obj.material_slots:
            if mat_slot.material:
                materials.add(mat_slot.material.name)

material_count = len(materials)

# GPU detection
gpu_available = False
gpu_device_name = ""
gpu_memory_mb = 0

try:
    prefs = bpy.context.preferences.addons.get('cycles')
    if prefs:
        cycles_prefs = prefs.preferences
        cycles_prefs.get_devices()
        for device_type in cycles_prefs.devices:
            if device_type.type != 'CPU' and device_type.use:
                gpu_available = True
                gpu_device_name = device_type.name[:256]
                break
except:
    pass

result_data = {
    "memory": {
        "usedMB": memory_used_mb,
        "totalMB": memory_total_mb
    },
    "scene": {
        "objectCount": object_count,
        "polygonCount": polygon_count,
        "vertexCount": vertex_count,
        "materialCount": material_count
    },
    "gpuAvailable": gpu_available
}

if gpu_available:
    result_data["gpu"] = {
        "deviceName": gpu_device_name,
        "memoryUsageMB": gpu_memory_mb
    }

result = result_data
`;
}
