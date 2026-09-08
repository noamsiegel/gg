import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const installer = join(dirname(dirname(fileURLToPath(import.meta.url))), 'install.sh');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gg-release-'));
  roots.push(root);
  const source = join(root, 'source'), home = join(root, 'installed'), bin = join(root, 'bin');
  mkdirSync(source); mkdirSync(bin);
  const env = { ...process.env, GG_HOME: home, BIN_DIR: bin, GG_REPO_URL: source,
    PATH: `${bin}:${process.env.PATH}`, RELEASE_RESPONSE: join(root, 'release'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.test' };
  function git(repo: string, ...args: string[]) {
    const r = spawnSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0); return r.stdout.trim();
  }
  git(source, 'init', '-q');
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\ncat "$RELEASE_RESPONSE"\n'); chmodSync(join(bin, 'curl'), 0o755);
  function release(version: string, tag = `v${version}`) {
    writeFileSync(join(source, 'gg'), `#!/bin/sh\nGG_VERSION="${version}"\necho "$GG_VERSION"\n`);
    chmodSync(join(source, 'gg'), 0o755); git(source, 'add', 'gg'); git(source, 'commit', '-qm', version);
    git(source, 'tag', tag); writeFileSync(env.RELEASE_RESPONSE, JSON.stringify({ tag_name: tag, draft: false, prerelease: false }));
    return git(source, 'rev-parse', 'HEAD');
  }
  function run() { return spawnSync('/bin/bash', [installer], { env, encoding: 'utf8' }); }
  return { root, source, home, env, git, release, run };
}

test('installer selects published tag despite newer main and safely updates existing installation', () => {
  const f = fixture(); const first = f.release('1.0.0');
  f.git(f.source, 'commit', '--allow-empty', '-qm', 'unreleased main');
  let r = f.run(); expect(r.status, r.stderr).toBe(0);
  expect(f.git(f.home, 'rev-parse', 'HEAD')).toBe(first);
  const second = f.release('2.0.0'); r = f.run(); expect(r.status, r.stderr).toBe(0);
  expect(f.git(f.home, 'rev-parse', 'HEAD')).toBe(second);
});

test('dirty files and local commits are preserved, and missing releases never fall back to main', () => {
  const f = fixture(); const first = f.release('1.0.0'); expect(f.run().status).toBe(0);
  f.release('2.0.0'); writeFileSync(join(f.home, 'local.txt'), 'keep me');
  expect(f.run().status).toBe(1); expect(readFileSync(join(f.home, 'local.txt'), 'utf8')).toBe('keep me');
  expect(f.git(f.home, 'rev-parse', 'HEAD')).toBe(first);
  f.git(f.home, 'add', 'local.txt'); f.git(f.home, 'commit', '-qm', 'local change');
  const local = f.git(f.home, 'rev-parse', 'HEAD');
  expect(f.run().status).toBe(1); expect(f.git(f.home, 'rev-parse', 'HEAD')).toBe(local);
  writeFileSync(f.env.RELEASE_RESPONSE, '{}'); expect(f.run().status).toBe(1);
  expect(f.git(f.home, 'rev-parse', 'HEAD')).toBe(local);
});

test('mismatched release version cannot replace existing executable', () => {
  const f = fixture(); const first = f.release('1.0.0'); expect(f.run().status).toBe(0);
  f.release('2.0.0', 'v3.0.0'); expect(f.run().status).toBe(1);
  expect(f.git(f.home, 'rev-parse', 'HEAD')).toBe(first);
});

test('draft, prerelease and malformed release metadata cannot install', () => {
  const f = fixture(); f.release('1.0.0');
  for (const release of [
    { tag_name: 'v1.0.0', draft: true, prerelease: false },
    { tag_name: 'v1.0.0', draft: false, prerelease: true },
    { tag_name: '--upload-pack=unsafe', draft: false, prerelease: false },
  ]) {
    writeFileSync(f.env.RELEASE_RESPONSE, JSON.stringify(release));
    expect(f.run().status).toBe(1);
  }
});
