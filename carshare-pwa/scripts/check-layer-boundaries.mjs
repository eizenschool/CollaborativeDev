import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, 'src');
const supportedExtensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css'];
const ignoredDirectories = new Set(['node_modules', 'dist', 'coverage', '__tests__']);

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target, files);
    else if (supportedExtensions.includes(path.extname(entry.name)) && !entry.name.includes('.test.')) files.push(target);
  }
  return files;
}

function resolveImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    base,
    ...supportedExtensions.map((extension) => `${base}${extension}`),
    ...supportedExtensions.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function layerOf(file) {
  const relative = path.relative(sourceRoot, file).replaceAll('\\', '/');
  if (relative === 'main.jsx') return 'presentation';
  if (relative.startsWith('presentation/')) return 'presentation';
  if (relative.startsWith('business-logic/')) return 'business-logic';
  if (relative.startsWith('data-access/')) return 'data-access';
  return 'other';
}

const allowedTargets = {
  presentation: new Set(['presentation', 'business-logic']),
  'business-logic': new Set(['business-logic', 'data-access']),
  'data-access': new Set(['data-access']),
};

const importPattern = /import\s+(?:[^'";]*?\s+from\s+)?(['"])([^'"]+)\1/g;
const exportPattern = /export\s+[^'";]*?\s+from\s+(['"])([^'"]+)\1/g;
const dynamicImportPattern = /import\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
const patterns = [importPattern, exportPattern, dynamicImportPattern];
const violations = [];
const graph = new Map();
const sharedSupabaseClient = path.join(sourceRoot, 'data-access', 'shared', 'supabase', 'supabaseClient.js');

for (const importer of walk(sourceRoot)) {
  const sourceLayer = layerOf(importer);
  if (!allowedTargets[sourceLayer]) continue;
  const dependencies = [];
  const source = fs.readFileSync(importer, 'utf8');
  if ((sourceLayer === 'presentation' || sourceLayer === 'business-logic') && /\bfetch\s*\(/.test(source)) {
    violations.push({
      importer,
      imported: importer,
      sourceLayer,
      targetLayer: sourceLayer,
      reason: 'direct network access belongs in a Data Access adapter',
    });
  }
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source))) {
      const imported = resolveImport(importer, match[2]);
      if (!imported) continue;
      dependencies.push(imported);
      const targetLayer = layerOf(imported);
      if (sourceLayer === 'business-logic' && imported === sharedSupabaseClient) {
        violations.push({ importer, imported, sourceLayer, targetLayer, reason: 'Business Logic must use a module Data Access adapter' });
      } else if (targetLayer !== 'other' && !allowedTargets[sourceLayer].has(targetLayer)) {
        violations.push({ importer, imported, sourceLayer, targetLayer, reason: 'disallowed layer direction' });
      }
    }
  }
  graph.set(importer, dependencies);
}

function findImportCycle() {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(file) {
    if (visiting.has(file)) return [...stack.slice(stack.indexOf(file)), file];
    if (visited.has(file)) return null;
    visiting.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) || []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(file);
    visited.add(file);
    return null;
  }

  for (const file of graph.keys()) {
    const cycle = visit(file);
    if (cycle) return cycle;
  }
  return null;
}

const importCycle = findImportCycle();

if (violations.length) {
  console.error('Layer-boundary violations found:');
  for (const violation of violations) {
    console.error(
      `- ${path.relative(projectRoot, violation.importer)} (${violation.sourceLayer}) -> `
      + `${path.relative(projectRoot, violation.imported)} (${violation.targetLayer}): ${violation.reason}`,
    );
  }
  process.exitCode = 1;
} else if (importCycle) {
  console.error('Import cycle found:');
  console.error(importCycle.map((file) => path.relative(projectRoot, file)).join(' -> '));
  process.exitCode = 1;
} else {
  console.log('Layer boundaries are valid and no local import cycles were found.');
}
