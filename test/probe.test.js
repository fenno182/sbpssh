import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeTarget } from '../src/probe.js';

const mk = (name, extra = {}) => ({ name, hostname: extra.hostname ?? name, port: extra.port ?? '22', proxyJump: extra.proxyJump ?? null, options: extra.options ?? {} });

test('direct hosts probe HostName:Port', () => {
  const h = mk('a', { hostname: '10.0.0.1', port: '2222' });
  assert.deepEqual(probeTarget(h, new Map()), { host: '10.0.0.1', port: 2222 });
});

test('ProxyJump alias probes the jump host instead', () => {
  const jump = mk('bastion', { hostname: '1.2.3.4', port: '22' });
  const h = mk('inner', { hostname: '10.0.0.5', proxyJump: 'bastion' });
  assert.deepEqual(probeTarget(h, new Map([['bastion', jump]])), { host: '1.2.3.4', port: 22, via: 'bastion' });
});

test('ProxyJump user@host:port that is not an alias is parsed', () => {
  const h = mk('inner', { proxyJump: 'me@jump.example.com:2200,other' });
  assert.deepEqual(probeTarget(h, new Map()), { host: 'jump.example.com', port: 2200, via: 'jump.example.com' });
});

test('ProxyCommand hosts are skipped', () => {
  const h = mk('weird', { options: { proxycommand: { value: 'nc %h %p' } } });
  assert.equal(probeTarget(h, new Map()), null);
});
