/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Python code generator for datablock cleanup operations.
 * Produces code that identifies and optionally removes orphaned
 * datablocks from all Blender registries.
 *
 * Requirement 1: Datablock Cleanup
 */

/**
 * Generates Python code that detects and/or removes orphaned datablocks.
 * Orphaned datablocks have zero users and are not marked as fake user.
 *
 * @param dryRun - When true, only reports orphaned datablocks without removing them
 * @returns Generated Python code string
 */
export function generateCleanupDatablocksCode(dryRun: boolean): string {
  return `import bpy
import json

# Registries to scan for orphaned datablocks
registries = [
    ("meshes", bpy.data.meshes),
    ("materials", bpy.data.materials),
    ("cameras", bpy.data.cameras),
    ("lights", bpy.data.lights),
    ("images", bpy.data.images),
    ("textures", bpy.data.textures),
    ("node_groups", bpy.data.node_groups),
    ("worlds", bpy.data.worlds),
    ("actions", bpy.data.actions),
    ("armatures", bpy.data.armatures),
    ("curves", bpy.data.curves),
    ("particles", bpy.data.particles),
]

dry_run = ${dryRun ? "True" : "False"}
removed = []
errors = []
removed_by_type = {}
total_found = 0

for reg_name, registry in registries:
    # Collect orphans first to avoid modifying collection during iteration
    orphans = [item for item in registry if item.users == 0 and not item.use_fake_user]
    total_found += len(orphans)

    if orphans:
        removed_by_type[reg_name] = len(orphans)

    if not dry_run:
        for item in orphans:
            try:
                name = item.name
                registry.remove(item)
                removed.append({"name": name, "type": reg_name})
            except Exception as e:
                errors.append({"name": item.name, "type": reg_name, "reason": str(e)})

# In dry_run mode, populate removed list with what would be removed
if dry_run:
    for reg_name, registry in registries:
        orphans = [item for item in registry if item.users == 0 and not item.use_fake_user]
        for item in orphans:
            removed.append({"name": item.name, "type": reg_name})

result = {
    "totalFound": total_found,
    "totalRemoved": len(removed) if not dry_run else 0,
    "removedByType": {k: v for k, v in removed_by_type.items() if v > 0},
    "removed": removed,
    "errors": errors if errors else []
}
`;
}
