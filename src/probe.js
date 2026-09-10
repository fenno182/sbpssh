// Background reachability probes (a TCP connect to HostName:Port) and lazy
// "live info" fetches over ssh. Both keep module-level caches so results
// survive the UI being unmounted while an ssh session runs.

import net from 'node:net';
import { execFile } from 'node:child_process';

// ─── reachability ────────────────────────────────────────────────────────────

export const probeResults = new Map(); // name → { status: 'up'|'down'|'checking', ms, at, target }
let inflight = 0;
const queue = [];
const CONCURRENCY = 8;

// Hosts behind a ProxyJump aren't directly reachable; probe the jump host instead.
export function probeTarget(host, byName) {
  if (!host.proxyJump || host.options.proxycommand) {
    return host.options.proxycommand ? null : { host: host.hostname, port: Number(host.port) || 22 };
  }
  const first = host.proxyJump.split(',')[0].trim();
  const alias = first.replace(/^.*@/, '').replace(/:\d+$/, '');
  const jump = byName.get(alias);
  if (jump) return { host: jump.hostname, port: Number(jump.port) || 22, via: alias };
  const m = /^(?:.*@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(first);
  return m ? { host: m[1].replace(/^\[|\]$/g, ''), port: Number(m[2]) || 22, via: alias } : null;
}

function tcpCheck(target, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = net.connect({ host: target.host, port: target.port });
    const done = (status) => { sock.destroy(); resolve({ status, ms: Date.now() - start }); };
    sock.setTimeout(timeout, () => done('down'));
    sock.once('connect', () => done('up'));
    sock.once('error', () => done('down'));
  });
}

function pump(timeout, onUpdate) {
  while (inflight < CONCURRENCY && queue.length) {
    const { name, target } = queue.shift();
    inflight++;
    tcpCheck(target, timeout).then((r) => {
      inflight--;
      probeResults.set(name, { ...r, at: Date.now(), target });
      onUpdate(name);
      pump(timeout, onUpdate);
    });
  }
}

/** Queue probes for every host whose result is missing or older than maxAge. */
export function probeAll(hosts, { timeout = 3000, maxAge = 60000, onUpdate = () => {} } = {}) {
  const byName = new Map(hosts.map(h => [h.name, h]));
  const now = Date.now();
  for (const host of hosts) {
    const prev = probeResults.get(host.name);
    if (prev && prev.status !== 'checking' && now - prev.at < maxAge) continue;
    if (queue.some(q => q.name === host.name)) continue;
    const target = probeTarget(host, byName);
    if (!target) { probeResults.set(host.name, { status: 'skip', at: now }); continue; }
    probeResults.set(host.name, { status: 'checking', at: now, target });
    queue.push({ name: host.name, target });
  }
  onUpdate();
  pump(timeout, onUpdate);
}

// ─── live info ───────────────────────────────────────────────────────────────

export const infoResults = new Map(); // name → { at, lines?, error?, pending? }
const INFO_TTL = 5 * 60 * 1000;

// Runs on the remote box; each line maps to a field below. Every command is
// guarded so a missing tool just yields an empty line rather than an error.
const REMOTE_SCRIPT = [
  'uptime -p 2>/dev/null || uptime 2>/dev/null',
  '. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-$(uname -s 2>/dev/null)}"',
  'uname -r 2>/dev/null',
  'cut -d" " -f1-3 /proc/loadavg 2>/dev/null',
  'free -m 2>/dev/null | awk \'/^Mem/{printf "%d / %d MB\\n",$3,$2}\'',
  'df -h / 2>/dev/null | awk \'NR==2{print $5" of "$2}\'',
  'hostname 2>/dev/null',
].join('; echo "\x1f"; ');

export const INFO_FIELDS = ['Uptime', 'OS', 'Kernel', 'Load', 'Memory', 'Disk /', 'Hostname'];

export function fetchInfo(name, sshArgs = [], onUpdate = () => {}) {
  const cached = infoResults.get(name);
  if (cached && (cached.pending || Date.now() - cached.at < INFO_TTL)) return;
  infoResults.set(name, { at: Date.now(), pending: true });
  onUpdate(name);
  const args = [...sshArgs, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'LogLevel=ERROR', name, REMOTE_SCRIPT];
  execFile('ssh', args, { timeout: 15000 }, (err, stdout, stderr) => {
    if (err && !stdout) {
      infoResults.set(name, { at: Date.now(), error: (stderr || err.message).trim().split('\n')[0] || 'failed' });
    } else {
      const lines = stdout.split('\x1f').map(s => s.trim().split('\n').pop().trim());
      infoResults.set(name, { at: Date.now(), lines });
    }
    onUpdate(name);
  });
}
