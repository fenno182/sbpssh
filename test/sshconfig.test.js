import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHosts } from '../src/sshconfig.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { hosts, files, errors } = loadHosts(path.join(here, 'fixtures', 'config'));
const byName = Object.fromEntries(hosts.map(h => [h.name, h]));

test('follows includes and records files', () => {
  assert.equal(files.length, 3);
  assert.equal(errors.length, 0); // an Include that matches nothing is not an error, as in ssh(1)
});

test('wildcard blocks are folded into concrete hosts, not listed', () => {
  assert.deepEqual(hosts.map(h => h.name).sort(), ['acme-tst-app-01', 'acme-tst-mng-01', 'box1', 'box2', 'plain']);
  assert.equal(byName['acme-tst-mng-01'].options.user.value, 'admin');
  assert.equal(byName['acme-tst-mng-01'].options.user.viaPattern, 'acme-*');
  assert.equal(byName['acme-tst-app-01'].options.user.value, 'override'); // first value wins
  assert.equal(byName['acme-tst-app-01'].options.user.viaPattern, null);
});

test('global options apply to every host', () => {
  assert.equal(byName.plain.options.serveraliveinterval.value, '30');
});

test('multi-pattern hosts, key=value syntax, accumulating options, negation', () => {
  assert.equal(byName.box2.options.hostname.value, 'box.example.com');
  assert.deepEqual(byName.box1.options.identityfile.values, ['~/.ssh/keys/one', '~/.ssh/keys/two']);
  assert.equal(byName.box1.options.proxyjump.value, 'bastion');
  assert.equal(byName.box2.options.proxyjump, undefined);
});

test('source file and line are tracked', () => {
  assert.ok(byName.plain.file.endsWith('fixtures/config'));
  assert.equal(byName.plain.line, 7);
  assert.ok(byName.box1.file.endsWith('b.conf'));
});
