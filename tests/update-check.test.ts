import { afterEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = join(dirname(dirname(fileURLToPath(import.meta.url))), 'update-check.sh');
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gg-update-test-'));
  temporary.push(root);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_CACHE_HOME: join(root, 'cache'),
    GG_NO_UPDATE_CHECK: '', GG_UPDATE_TEST_ROOT: root,
    GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'gg test', GIT_AUTHOR_EMAIL: 'gg@example.test',
    GIT_COMMITTER_NAME: 'gg test', GIT_COMMITTER_EMAIL: 'gg@example.test',
  };
  function git(...args: string[]) {
    const result = spawnSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  }
  git('init', '-q');
  git('config', 'core.hooksPath', '/dev/null');
  writeFileSync(join(repo, 'gg'), 'GG_VERSION="1.0.0"\n');
  git('add', 'gg');
  git('commit', '-qm', 'fixture');
  const installed = git('rev-parse', 'HEAD');
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$GG_UPDATE_TEST_ROOT/calls"
cat "$GG_UPDATE_TEST_ROOT/response"
exit "$(cat "$GG_UPDATE_TEST_ROOT/status")"
`);
  chmodSync(join(bin, 'curl'), 0o755);
  function response(value: { tag_name: string, draft?: boolean, prerelease?: boolean }, status = 0) {
    writeFileSync(join(root, 'response'), JSON.stringify({ draft: false, prerelease: false, ...value }));
    writeFileSync(join(root, 'status'), String(status));
  }
  response({ tag_name: 'v2.0.0' });
  function run(extra = {}) {
    const result = spawnSync('/bin/bash', [script, repo], { env: { ...env, ...extra }, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    return JSON.parse(result.stdout);
  }
  return { root, env, git, installed, response, run, calls: () => existsSync(join(root, 'calls')) ? readFileSync(join(root, 'calls'), 'utf8').trim().split('\n') : [] };
}

test('reports update metadata with bounded request and reuses the paired cache', () => {
  const f = fixture();
  const result = f.run();
  expect(result).toEqual({ status: 'available', installed_revision: f.installed, latest_revision: null, latest_version: 'v2.0.0', command: 'gg self-update' });
  expect(f.run()).toEqual(result);
  expect(f.calls()).toHaveLength(1);
  expect(f.calls()[0]).toContain('--connect-timeout 2 --max-time 2');
  expect(f.calls()[0]).toContain('https://api.github.com/repos/noamsiegel/gg/releases/latest');
  f.git('commit', '--allow-empty', '-qm', 'new installed revision');
  expect(f.run().installed_revision).not.toBe(f.installed);
  expect(f.calls()).toHaveLength(2);
});

test('recognizes the installed release version', () => {
  const f = fixture();
  f.response({ tag_name: 'v1.0.0' });
  expect(f.run().status).toBe('current');
  f.git('commit', '--allow-empty', '-qm', 'local change');
  expect(f.run().status).toBe('current');
});

test('disabled check does not read cache or make a request', () => {
  const f = fixture();
  expect(f.run({ GG_NO_UPDATE_CHECK: '1' }).status).toBe('unknown');
  expect(f.calls()).toHaveLength(0);
  expect(existsSync(f.env.XDG_CACHE_HOME)).toBe(false);
});

test('rejects remote data and expires unknown cache entries after a day', () => {
  const f = fixture();
  f.response({ tag_name: '$(touch unsafe)' });
  expect(f.run().latest_revision).toBe(null);
  f.response({ tag_name: 'v2.0.0' });
  expect(f.run().status).toBe('unknown');
  expect(f.calls()).toHaveLength(1);
  const cache = join(f.env.XDG_CACHE_HOME, 'gg/releases.json');
  const contents = JSON.parse(readFileSync(cache, 'utf8'));
  writeFileSync(cache, JSON.stringify({ ...contents, checked_at: 1 }));
  expect(f.run().status).toBe('available');
  expect(f.calls()).toHaveLength(2);
});

test('a failed request cannot supply an otherwise valid revision', () => {
  const f = fixture();
  f.response({ tag_name: 'v2.0.0' }, 22);
  expect(f.run().status).toBe('unknown');
  expect(f.run().latest_revision).toBe(null);
  expect(f.calls()).toHaveLength(1);
});
