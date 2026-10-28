import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['tabs', 'storage']);
assert.equal(manifest.incognito, 'not_allowed');
for (const field of ['host_permissions', 'content_scripts', 'background']) {
  assert.equal(manifest[field], undefined, `Unexpected ${field}`);
}
assert.ok(existsSync(resolve(root, manifest.action.default_popup)));
const html = read(manifest.action.default_popup);
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  assert.ok(!match[1].includes(':'), 'Remote resource found');
  assert.ok(existsSync(resolve(root, match[1])), `Missing ${match[1]}`);
}
assert.match(html, /id="save"[^>]*disabled/);
assert.match(html, /이어서 시작/);
assert.match(html, /<details id="reference-panel">/);
assert.match(read('popup.css'), /html\s*\{[^}]*min-width:\s*600px/);
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  assert.equal(match[1].trim(), '', 'Inline script found');
}
const js = read('popup.js');
assert.ok(!/\bconfirm\s*\(/.test(js), 'Native confirm must be replaced with inline confirmation');
assert.match(html, /id="error" role="alert"/);
assert.ok(!/innerHTML|fetch\s*\(|chrome\.(tabs|storage)\./.test(js));
for (const file of ['popup.js','src/model.js','src/tabs.js','src/render.js','src/storage.js']) {
  const source = read(file);
  assert.ok(!/innerHTML|fetch\s*\(/.test(source));
  execFileSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'pipe' });
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    assert.ok(existsSync(resolve(root, dirname(file), match[1])), `Missing import ${match[1]}`);
  }
}
for (const name of ['AGENTS.md', 'README.md', 'SPEC.md', 'CHECKLIST.md']) {
  assert.ok(read(name).trim().length > 0);
}
console.log('PASS: manifest/MV3/permissions, local resources/imports, initially disabled save, resume CTA/collapsed references, 600px minimum width, JS syntax, docs.');
console.log('NOT RUN by this script: Chrome installation/rendering/API behavior or UX. Run node --test separately for model/API mock tests.');
