import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { convert } from 'ast-v8-to-istanbul';
import { parseAstAsync } from 'vite';
import { createCoverageMap } from '@vitest/istanbul-lib-coverage';

// Verification tooling stays in the source workspace; the production module has no sibling runtime import.
const root = fileURLToPath(new URL('../../be-poin-peserta/', import.meta.url));
const moduleRoot = path.join(root, 'apps/leadership-race');
const coverageDirectory = path.join(moduleRoot, '.coverage-v8-c');
await fs.mkdir(coverageDirectory, { recursive: true });
if ((await fs.readdir(coverageDirectory)).length) throw new Error('Coverage directory must be empty before collection');
const tests = (await fs.readdir(path.join(root, 'tests/leadership-race')))
  .filter((file) => file.endsWith('.test.cjs')).map((file) => `tests/leadership-race/${file}`);
const run = spawnSync(process.execPath, ['--test', '--test-concurrency=4', '--experimental-test-coverage',
  '--test-coverage-include=apps/leadership-race/**', '--test-coverage-lines=90',
  '--test-coverage-functions=90', '--test-coverage-branches=85', ...tests], {
  cwd: root, env: { ...process.env, NODE_V8_COVERAGE: coverageDirectory }, stdio: 'inherit'
});
if (run.status !== 0) throw new Error('Native coverage/tests failed');
const map = createCoverageMap({});
const observed = new Set();
let scripts = 0;
for (const file of await fs.readdir(coverageDirectory)) {
  const raw = JSON.parse(await fs.readFile(path.join(coverageDirectory, file), 'utf8'));
  for (const coverage of raw.result) {
    if (!coverage.url.startsWith('file:')) continue;
    const filename = fileURLToPath(coverage.url);
    const relative = path.relative(moduleRoot, filename);
    if (relative.startsWith('..') || !/\.(cjs|js)$/.test(relative)) continue;
    const code = await fs.readFile(filename, 'utf8');
    // Node's raw script coverage describes the file source itself; no synthetic CJS wrapper is present.
    const largestOffset = Math.max(...coverage.functions.flatMap((fn) => fn.ranges.map((range) => range.endOffset)));
    if (largestOffset > code.length) throw new Error(`Unexpected execution wrapper in ${relative}`);
    const converted = await convert({ ast: parseAstAsync(code), code, coverage, wrapperLength: 0 });
    map.merge(converted);
    observed.add(path.resolve(filename));
    scripts += 1;
  }
}
async function sourceFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (['.npm-cache', '.coverage-v8-c', 'logs'].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(filename));
    else if (/\.(cjs|js)$/.test(entry.name)) files.push(path.resolve(filename));
  }
  return files;
}
const missing = (await sourceFiles(moduleRoot)).filter((file) => !observed.has(file));
if (missing.length) throw new Error(`Unmeasured source files: ${missing.join(', ')}`);
const summary = map.getCoverageSummary().toJSON();
const result = { files: observed.size, scripts, summary };
await fs.writeFile(path.join(moduleRoot, 'checkpoint-c-coverage.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
for (const [metric, minimum] of Object.entries({ statements: 90, lines: 90, functions: 90, branches: 85 })) {
  if (summary[metric].pct < minimum) throw new Error(`${metric} below ${minimum}%`);
}
