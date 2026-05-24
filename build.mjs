import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(packageDir, '..', '..');
const sourceDir = path.join(rootDir, 'dist', 'src');
const outDir = path.join(packageDir, 'dist');

const files = [
  ['state', 'index'],
  ['subscription', 'subscription'],
  ['path-map', 'path-map'],
  ['constants', 'constants'],
  ['apply', 'apply'],
  ['clone', 'clone'],
  ['diff', 'diff'],
  ['engine', 'engine'],
  ['equal', 'equal'],
  ['history', 'history'],
  ['profile', 'profile'],
  ['object', 'object'],
  ['pointer', 'pointer'],
  ['patch-validate', 'patch-validate'],
  ['validate', 'validate'],
  ['unicode', 'unicode']
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const [sourceBase, targetBase] of files) {
  for (const extension of ['.js', '.d.ts']) {
    const source = path.join(sourceDir, sourceBase + extension);
    if (!fs.existsSync(source)) continue;
    const target = path.join(outDir, targetBase + extension);
    const text = fs.readFileSync(source, 'utf8')
      .replaceAll(sourceBase + extension + '.map', targetBase + extension + '.map')
      .replace(/\n\/\/# sourceMappingURL=.*$/u, '');
    fs.writeFileSync(target, text);
  }
}

fs.copyFileSync(path.join(packageDir, 'state-types.d.ts'), path.join(outDir, 'types.d.ts'));
