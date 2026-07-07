/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Adds license headers to all source code files in the workspace.
 * Skips node_modules, dist, .git, and compiled .js/.d.ts files that sit next to .ts sources.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TS_JS_HEADER = `/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */
`;

const PY_HEADER = `# LLM Toolkit
# Copyright 2026 Shawna Pakbin
# Licensed under the Apache License, Version 2.0
# See LICENSE file in the project root for full license text.
`;

const YAML_HEADER = `# LLM Toolkit
# Copyright 2026 Shawna Pakbin
# Licensed under the Apache License, Version 2.0
# See LICENSE file in the project root for full license text.
`;

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vs', '.vscode', '.kiro', '.husky']);

// Extensions and their header style
const EXT_MAP = {
  '.ts': TS_JS_HEADER,
  '.tsx': TS_JS_HEADER,
  '.js': TS_JS_HEADER,
  '.mjs': TS_JS_HEADER,
  '.cjs': TS_JS_HEADER,
  '.py': PY_HEADER,
  '.yml': YAML_HEADER,
  '.yaml': YAML_HEADER,
};

// Files to skip entirely (config files that don't support comments or compiled outputs)
const SKIP_FILES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.test.json',
  'biome.json',
  'manifest.json',
  'tasks.json',
  'jest.config.json',
]);

// Skip compiled .js and .d.ts if a .ts source exists alongside
function isCompiledOutput(filePath) {
  const ext = path.extname(filePath);
  if (ext === '.js' || ext === '.d.ts') {
    const base = filePath.replace(/\.(d\.ts|js)$/, '.ts');
    if (fs.existsSync(base)) return true;
  }
  return false;
}

function hasLicenseHeader(content) {
  const top = content.slice(0, 300);
  return top.includes('LLM Toolkit') || top.includes('Apache License') || top.includes('Copyright 2026 Shawna Pakbin');
}

function addHeader(filePath, header) {
  let content = fs.readFileSync(filePath, 'utf8');

  if (hasLicenseHeader(content)) {
    return false; // already has header
  }

  // For Python files, preserve shebang line
  if (content.startsWith('#!')) {
    const newlineIdx = content.indexOf('\n');
    const shebang = content.slice(0, newlineIdx + 1);
    const rest = content.slice(newlineIdx + 1);
    content = shebang + '\n' + header + '\n' + rest;
  } else {
    content = header + '\n' + content;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

function walk(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      count += walk(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const header = EXT_MAP[ext];

      if (!header) continue;
      if (SKIP_FILES.has(entry.name)) continue;
      if (isCompiledOutput(fullPath)) continue;

      if (addHeader(fullPath, header)) {
        console.log(`  + ${path.relative(ROOT, fullPath)}`);
        count++;
      }
    }
  }
  return count;
}

console.log('Adding license headers...\n');
const total = walk(ROOT);
console.log(`\nDone. Added headers to ${total} files.`);
