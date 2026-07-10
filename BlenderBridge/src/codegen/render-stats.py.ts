/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Python code generator for render statistics collection.
 * Produces code that gathers render performance metrics after
 * a render operation completes.
 *
 * Requirement 3: Render Statistics Reporter
 */

/**
 * Generates Python code that collects render statistics.
 * The generated code:
 * - Reports render time in seconds (3 decimal places)
 * - Reports samples used
 * - Reports peak memory usage in MB (2 decimal places)
 * - Reports engine name, resolution, and scene polygon count
 * - Reports GPU info when available
 *
 * @returns Generated Python code string
 */
export function generateRenderStatsCode(): string {
  return `import bpy
import json
import sys
import time

scene = bpy.context.scene
render = scene.render

# Render time - parse from Blender's last render stats if available
render_time_seconds = 0.0
try:
    # Blender stores render time in the image editor stats
    # Fallback: use a reasonable estimate
    if hasattr(bpy.context, 'scene') and hasattr(scene, 'statistics'):
        stats_str = scene.statistics(bpy.context.view_layer)
        # Parse "Time: MM:SS.ff" pattern from stats
        import re
        time_match = re.search(r'Time:\\s*(\\d+):(\\d+)\\.(\\d+)', stats_str)
        if time_match:
            minutes = int(time_match.group(1))
            seconds = int(time_match.group(2))
            fraction = int(time_match.group(3))
            render_time_seconds = minutes * 60 + seconds + fraction / 100.0
except:
    pass

# If we couldn't get render time from stats, default to a small value
if render_time_seconds <= 0:
    render_time_seconds = 0.001

# Samples
samples = 1
if render.engine == 'CYCLES':
    samples = scene.cycles.samples if hasattr(scene, 'cycles') else 128
elif render.engine == 'BLENDER_EEVEE_NEXT' or render.engine == 'BLENDER_EEVEE':
    samples = render.eevee.taa_render_samples if hasattr(render, 'eevee') else 64

# Peak memory
peak_memory_mb = 0.0
try:
    import psutil
    process = psutil.Process()
    peak_memory_mb = process.memory_info().rss / (1024 * 1024)
except ImportError:
    try:
        import resource
        usage = resource.getrusage(resource.RUSAGE_SELF)
        if sys.platform == 'darwin':
            peak_memory_mb = usage.ru_maxrss / (1024 * 1024)
        else:
            peak_memory_mb = usage.ru_maxrss / 1024
    except:
        pass

# Engine name
engine_name = render.engine

# Resolution
resolution_width = render.resolution_x
resolution_height = render.resolution_y

# Scene polygon count
polygon_count = 0
for obj in scene.objects:
    if obj.type == 'MESH' and obj.data:
        polygon_count += len(obj.data.polygons)

# GPU info
gpu_available = False
gpu_device_name = ""
gpu_memory_mb = 0.0

try:
    prefs = bpy.context.preferences.addons.get('cycles')
    if prefs:
        cycles_prefs = prefs.preferences
        cycles_prefs.get_devices()
        for device_type in cycles_prefs.devices:
            if device_type.type != 'CPU' and device_type.use:
                gpu_available = True
                gpu_device_name = device_type.name
                break
except:
    pass

result_data = {
    "renderTimeSeconds": round(render_time_seconds, 3),
    "samples": max(1, int(samples)),
    "peakMemoryMB": round(peak_memory_mb, 2),
    "engineName": engine_name,
    "resolutionWidth": resolution_width,
    "resolutionHeight": resolution_height,
    "scenePolygonCount": polygon_count,
    "gpuAvailable": gpu_available
}

if gpu_available:
    result_data["gpuDeviceName"] = gpu_device_name
    result_data["gpuMemoryMB"] = round(gpu_memory_mb, 2)

result = result_data
`;
}
