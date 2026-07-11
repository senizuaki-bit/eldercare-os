import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const forbiddenPatterns = [
  'BEGIN (RSA|OPENSSH|EC) PRIVATE KEY',
  'sk-[A-Za-z0-9]{20,}',
  'AKIA[0-9A-Z]{16}',
  'ghp_[A-Za-z0-9]{30,}',
  'xox[baprs]-[A-Za-z0-9-]{20,}'
];

const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false
});

if (result.status !== 0) {
  console.error(result.stderr || 'Repository scan could not run.');
  process.exit(result.status ?? 2);
}

const binaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.pdf']);
const patterns = forbiddenPatterns.map((pattern) => new RegExp(pattern, 'i'));
const findings = [];

for (const file of result.stdout.split('\0').filter(Boolean)) {
  if (binaryExtensions.has(extname(file).toLowerCase()) || file === 'scripts/scan-repository.mjs') continue;
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (patterns.some((pattern) => pattern.test(line))) findings.push(`${file}:${index + 1}`);
  });
}

if (findings.length > 0) {
  console.error(`Potential secret patterns found:\n${findings.join('\n')}`);
  process.exit(1);
}

console.log('Repository secret-pattern scan passed.');
