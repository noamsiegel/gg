/**
 * git-guardrails fixture-based test suite.
 *
 * Run: bun test tests/git-guardrails.test.ts
 *
 * Each test spawns a real temp git repo, exercises a hook through the actual
 * shim chain, and asserts on git state + exit codes. No mocks. The repos are
 * disposable; cleanup runs after each test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GIT_GUARDRAILS = join(REPO_ROOT, 'git-guardrails');
// Build the test key at runtime so GitHub's secret scanner doesn't flag this
// source file. Gitleaks still detects the leak inside the test git repo because
// the key is written verbatim to disk there.
const STRIPE_KEY_LIKE = `const k = '${['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dc'].join('_')}';`;

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function output(r: SpawnResult): string {
  return `${r.stdout}\n${r.stderr}`.trim();
}

function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}): SpawnResult {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return {
    status: r.status,
    stdout: r.stdout?.toString() ?? '',
    stderr: r.stderr?.toString() ?? '',
  };
}

function git(repo: string, ...args: Array<string | SpawnSyncOptions>): SpawnResult {
  // Last arg may be an options object; if so peel it off.
  let opts: SpawnSyncOptions = {};
  if (args.length > 0 && typeof args[args.length - 1] === 'object') {
    opts = args.pop() as SpawnSyncOptions;
  }
  return run('git', ['-C', repo, ...(args as string[])], opts);
}

function testEnv(configHome: string): NodeJS.ProcessEnv {
  const toolPath = `${REPO_ROOT}/node_modules/.bin:${process.env.PATH ?? ''}`;
  const globalNodePaths = [
    `${REPO_ROOT}/node_modules`,
    `${process.env.HOME}/.bun/install/global/node_modules`,
    `${process.env.HOME}/.local/share/bun/install/global/node_modules`,
  ];
  return {
    ...process.env,
    GIT_GUARDRAILS_TEMPLATES: REPO_ROOT,
    GIT_GUARDRAILS_PATH: toolPath,
    XDG_CONFIG_HOME: configHome,
    PATH: `${REPO_ROOT}:${toolPath}`,
    NODE_PATH: `${globalNodePaths.join(':')}${process.env.NODE_PATH ? `:${process.env.NODE_PATH}` : ''}`,
  };
}

function newRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-guardrails-test-'));
  const configHome = join(dir, 'xdg');
  mkdirSync(configHome, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'git-guardrails-test');
  const install = run(GIT_GUARDRAILS, ['install', '--force'], { cwd: dir, env: testEnv(configHome) });
  if (install.status !== 0) {
    throw new Error(`git-guardrails install failed: ${install.stderr || install.stdout}`);
  }
  return dir;
}

function newBareRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-guardrails-test-'));
  const configHome = join(dir, 'xdg');
  mkdirSync(configHome, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'git-guardrails-test');
  return dir;
}

function hooksDir(repo: string): string {
  return git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').stdout.trim() + '/hooks';
}

function envForRepo(repo: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...testEnv(join(repo, 'xdg')), ...extra };
}

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function commitCount(repo: string): number {
  const r = git(repo, 'rev-list', '--count', 'HEAD');
  if (r.status !== 0) return 0;
  return Number.parseInt(r.stdout.trim(), 10);
}

describe('R5 — gitleaks baseline cannot be weakened by hostile repo .gitleaks.toml', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  test('hostile repo .gitleaks.toml allowing everything still blocks via baseline', () => {
    writeFileSync(join(repo, '.gitleaks.toml'), `
title = "hostile"
[extend]
useDefault = true
[[allowlists]]
description = "block nothing"
regexes = ['''.*''']
`);
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts', '.gitleaks.toml');
    const r = git(repo, 'commit', '-m', 'feat: add', { env: envForRepo(repo) });
    expect(r.status).not.toBe(0);
    expect(commitCount(repo)).toBe(0);
  });

  test('SKIP_GITLEAKS=1 bypasses gitleaks but other checks still run', () => {
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts');
    const r = git(repo, 'commit', '-m', 'feat: ok', { env: envForRepo(repo, { SKIP_GITLEAKS: '1' }) });
    expect(r.status, output(r)).toBe(0);
  });
});

describe('R6 — branch-guard list-vs-regex API', () => {
  const guard = join(REPO_ROOT, 'checks', 'branch-guard.sh');
  const ZERO = '0'.repeat(40);
  const ONE = '1'.repeat(40);

  function runGuard(stdin: string, env: Record<string, string> = {}): SpawnResult {
    return run(guard, [], {
      input: stdin,
      env: { ...testEnv(mkdtempSync(join(tmpdir(), 'git-guardrails-xdg-'))), ...env },
    });
  }

  test('protected-ref decisions are exact and bypassable', () => {
    const cases: Array<[string, string, Record<string, string> | undefined, number]> = [
      ['default regex blocks main', `refs/heads/main ${ONE} refs/heads/main ${ZERO}\n`, undefined, 1],
      ['default regex does not match domain', `refs/heads/domain ${ONE} refs/heads/domain ${ZERO}\n`, undefined, 0],
      ['default regex does not match feature-main', `refs/heads/feature-main ${ONE} refs/heads/feature-main ${ZERO}\n`, undefined, 0],
      ['LIST mode exact match blocks develop', `refs/heads/develop ${ONE} refs/heads/develop ${ZERO}\n`, { PROTECTED_BRANCHES_LIST: 'main,develop' }, 1],
      ['LIST mode main does not match domain', `refs/heads/domain ${ONE} refs/heads/domain ${ZERO}\n`, { PROTECTED_BRANCHES_LIST: 'main' }, 0],
      ['tag pushes are ignored', `refs/tags/v1 ${ONE} refs/tags/v1 ${ZERO}\n`, undefined, 0],
      ['branch deletions are ignored', `refs/heads/main ${ZERO} refs/heads/main ${ONE}\n`, undefined, 0],
      ['ALLOW_PROTECTED_PUSH bypasses', `refs/heads/main ${ONE} refs/heads/main ${ZERO}\n`, { ALLOW_PROTECTED_PUSH: '1' }, 0],
    ];

    for (const [name, stdin, env, status] of cases) {
      const r = runGuard(stdin, env);
      expect(r.status, name).toBe(status);
    }
  });
});

describe('R7 — large-files inspects STAGED blob, not worktree', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  test('staged-blob size logic uses staged content and threshold override', () => {
    writeFileSync(join(repo, 'big.bin'), Buffer.alloc(6 * 1024 * 1024));
    git(repo, 'add', 'big.bin');
    writeFileSync(join(repo, 'big.bin'), 'tiny');
    const blocked = git(repo, 'commit', '-m', 'feat: x', { env: envForRepo(repo) });
    expect(blocked.status).not.toBe(0);
    expect(commitCount(repo)).toBe(0);
    git(repo, 'reset', '-q');

    writeFileSync(join(repo, 'allowed.bin'), Buffer.alloc(6 * 1024 * 1024));
    git(repo, 'add', 'allowed.bin');
    const allowedByEnv = git(repo, 'commit', '-m', 'feat: big', { env: envForRepo(repo, { LARGE_FILE_LIMIT_MB: '20' }) });
    expect(allowedByEnv.status, output(allowedByEnv)).toBe(0);

    writeFileSync(join(repo, 'tiny.txt'), 'small');
    git(repo, 'add', 'tiny.txt');
    writeFileSync(join(repo, 'tiny.txt'), Buffer.alloc(10 * 1024 * 1024));
    const stagedSmall = git(repo, 'commit', '-m', 'feat: small', { env: envForRepo(repo) });
    expect(stagedSmall.status).toBe(0);
  });
});

describe('ADR-008/009 — python-bugs is a config-free bug gate, not a lint gate', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  // NameError at runtime: F821. Wrong in every repo, under every style policy.
  const BUGGY_PY = 'def handler(event):\n    return undefined_thing(event)\n';

  test('hostile pyproject.toml cannot silence the gate', () => {
    // Every documented way a repo can suppress a rule, in one file. The
    // per-file-ignores entry is the load-bearing one: `--config` alone still
    // honors it, so only `--isolated` defeats this fixture.
    writeFileSync(
      join(repo, 'pyproject.toml'),
      [
        '[tool.ruff]',
        'builtins = ["undefined_thing"]',
        'extend-exclude = ["*.py"]',
        '[tool.ruff.lint]',
        'select = []',
        'ignore = ["F821", "F"]',
        '[tool.ruff.lint.per-file-ignores]',
        '"*.py" = ["F821", "F822", "E902"]',
        '',
      ].join('\n'),
    );
    writeFileSync(join(repo, 'app.py'), BUGGY_PY);
    git(repo, 'add', 'app.py', 'pyproject.toml');
    const r = git(repo, 'commit', '-m', 'feat: add handler', { env: envForRepo(repo) });
    expect(r.status, output(r)).not.toBe(0);
    expect(commitCount(repo)).toBe(0);
  });

  // Asserted at the script seam, not through `git commit`: lefthook stashes
  // unstaged changes before pre-commit, so the full commit path cannot
  // distinguish index bytes from worktree bytes. The check must not depend on
  // lefthook's stash for invariant 8, so observe the script's own exit code.
  test('checks the STAGED blob, not the repaired worktree', () => {
    const check = join(REPO_ROOT, 'checks', 'python-bugs.sh');
    const env = testEnv(mkdtempSync(join(tmpdir(), 'git-guardrails-xdg-')));

    writeFileSync(join(repo, 'app.py'), BUGGY_PY);
    git(repo, 'add', 'app.py');
    writeFileSync(join(repo, 'app.py'), 'def handler(event):\n    return event\n');
    const stagedBuggy = run(check, ['--', 'app.py'], { cwd: repo, env });
    expect(stagedBuggy.status, output(stagedBuggy)).toBe(1);
    // Findings must be attributed to the real path; ruff reading stdin reports
    // `-` unless --stdin-filename is passed, which makes the hook unactionable.
    expect(output(stagedBuggy)).toContain('app.py');

    // Inverse: a clean index with a broken worktree must not block.
    git(repo, 'add', 'app.py');
    writeFileSync(join(repo, 'app.py'), BUGGY_PY);
    const stagedClean = run(check, ['--', 'app.py'], { cwd: repo, env });
    expect(stagedClean.status, output(stagedClean)).toBe(0);
  });

  test('style and repo-policy violations do not block', () => {
    // Unused import (F401), no formatting, long line, single-char names. Every
    // one of these is a repo policy question, so the baseline must stay silent.
    writeFileSync(
      join(repo, 'messy.py'),
      `import os\nimport sys\nx=1\ndef  f( a ):\n  return a+x  # ${'y'.repeat(160)}\n`,
    );
    git(repo, 'add', 'messy.py');
    const r = git(repo, 'commit', '-m', 'feat: messy but working', { env: envForRepo(repo) });
    expect(r.status, output(r)).toBe(0);
  });

  test('valid code that only a host runtime resolves is not a finding', () => {
    // Every case here is working Python that ruff -isolated flags by default.
    // A baseline check that blocks these teaches --no-verify, which is not
    // per-check and takes gitleaks down with it.
    const valid: Record<string, string> = {
      // Sphinx injects `tags` into conf.py.
      'docs/conf.py': "project = 'x'\nif tags.has('draft'):\n    pass\n",
      // IPython injects get_ipython/display.
      'startup.py': "get_ipython().run_line_magic('load_ext', 'autoreload')\n",
      // Decorator-registered handlers legitimately share a name: the route is
      // already registered, so the redefinition is not a runtime bug (F811).
      'routes.py': "from flask import Flask\napp = Flask(__name__)\n\n\n@app.route('/a')\ndef h():\n    return 'a'\n\n\n@app.route('/b')\ndef h():\n    return 'b'\n",
    };
    mkdirSync(join(repo, 'docs'), { recursive: true });
    for (const [path, src] of Object.entries(valid)) {
      writeFileSync(join(repo, path), src);
    }
    git(repo, 'add', ...Object.keys(valid));
    const r = git(repo, 'commit', '-m', 'feat: host-resolved globals', { env: envForRepo(repo) });
    expect(r.status, output(r)).toBe(0);
  });

  test('a gitlink whose path ends in .py is skipped, not reported as a bug', () => {
    // mode 160000 is a commit object; `git cat-file blob` fails on it, and
    // under `set -o pipefail` that failure would surface as a finding.
    // A gitlink needs a real object id, which needs a commit; without one
    // `update-index --cacheinfo` is rejected and this test would pass
    // vacuously, so assert the index really holds mode 160000 first.
    writeFileSync(join(repo, 'seed.txt'), 'seed\n');
    git(repo, 'add', 'seed.txt');
    git(repo, 'commit', '--no-verify', '-m', 'chore: seed');
    const sha = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const staged = git(repo, 'update-index', '--add', '--cacheinfo', `160000,${sha},vendor.py`);
    expect(staged.status, output(staged)).toBe(0);
    expect(git(repo, 'ls-files', '--stage', '--', 'vendor.py').stdout).toContain('160000');

    const r = run(join(REPO_ROOT, 'checks', 'python-bugs.sh'), ['--', 'vendor.py'], {
      cwd: repo,
      env: testEnv(mkdtempSync(join(tmpdir(), 'git-guardrails-xdg-'))),
    });
    expect(r.status, output(r)).toBe(0);
  });

  test('SKIP_PYTHON_BUGS=1 bypasses only this check', () => {
    writeFileSync(join(repo, 'app.py'), BUGGY_PY);
    git(repo, 'add', 'app.py');
    const r = git(repo, 'commit', '-m', 'feat: add handler', { env: envForRepo(repo, { SKIP_PYTHON_BUGS: '1' }) });
    expect(r.status, output(r)).toBe(0);
  });
});

describe('Bypass envvar surface', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  test('GIT_GUARDRAILS_SKIP=1 skips git-guardrails entirely', () => {
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts');
    const r = git(repo, 'commit', '-m', 'bad msg', { env: envForRepo(repo, { GIT_GUARDRAILS_SKIP: '1' }) });
    // commitlint would normally block "bad msg" too, but it's also skipped.
    expect(r.status).toBe(0);
  });

  test('legacy SKIP_PERSONAL_HOOKS no longer skips git-guardrails', () => {
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts');
    const r = git(repo, 'commit', '-m', 'feat: ok', { env: envForRepo(repo, { SKIP_PERSONAL_HOOKS: '1' }) });
    expect(r.status).not.toBe(0);
  });

  test('--no-verify bypasses everything (wt and git-guardrails)', () => {
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts');
    const r = git(repo, 'commit', '--no-verify', '-m', 'bad');
    expect(r.status).toBe(0);
  });

  test('user-owned .opt-out skips repo entirely', () => {
    // The shim resolves repo_root via `git rev-parse --show-toplevel`, which
    // canonicalizes /var/folders/... → /private/var/folders/... on macOS.
    // Use the same canonical form when writing the opt-out file.
    const canonical = git(repo, 'rev-parse', '--show-toplevel').stdout.trim();
    const optOutDir = join(repo, 'xdg', 'git-guardrails');
    mkdirSync(optOutDir, { recursive: true });
    writeFileSync(join(optOutDir, '.opt-out'), `${canonical}\n`);
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts');
    const r = git(repo, 'commit', '-m', 'feat: ok', { env: envForRepo(repo) });
    expect(r.status).toBe(0);
  });

  test('user-owned .opt-out canonicalization is respected from symlinked repo path', () => {
    const scanRoot = mkdtempSync(join(tmpdir(), 'git-guardrails-symlink-'));
    try {
      const realRepo = join(scanRoot, 'real', 'foo');
      const symParent = join(scanRoot, 'sym');
      const symRepo = join(symParent, 'foo');
      mkdirSync(realRepo, { recursive: true });
      mkdirSync(symParent, { recursive: true });
      git(realRepo, 'init', '-q', '-b', 'main');
      git(realRepo, 'config', 'user.email', 'test@example.com');
      git(realRepo, 'config', 'user.name', 'git-guardrails-test');
      symlinkSync(realRepo, symRepo, 'dir');

      const configHome = join(scanRoot, 'xdg');
      const optOutDir = join(configHome, 'git-guardrails');
      mkdirSync(optOutDir, { recursive: true });
      const canonical = git(realRepo, 'rev-parse', '--show-toplevel').stdout.trim();
      writeFileSync(join(optOutDir, '.opt-out'), `${canonical}\n`);

      writeFileSync(join(realRepo, 'leak.ts'), STRIPE_KEY_LIKE);
      git(realRepo, 'add', 'leak.ts');
      const r = run(GIT_GUARDRAILS, ['run', 'pre-commit'], {
        cwd: symRepo,
        env: testEnv(configHome),
      });
      expect(r.status).toBe(0);
    } finally {
      cleanup(scanRoot);
    }
  });

  test('in-repo .no-personal-hooks marker does NOT opt out (R1)', () => {
    writeFileSync(join(repo, '.no-personal-hooks'), '');
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', '.no-personal-hooks', 'leak.ts');
    const r = git(repo, 'commit', '-m', 'feat: x', { env: envForRepo(repo) });
    expect(r.status).not.toBe(0);
  });
});

describe('R3 — env var poisoning cannot disable hooks', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  test('ambient WT_HOOK_RUNNING=1 alone does NOT bypass', () => {
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts');
    const r = git(repo, 'commit', '-m', 'feat: x', { env: envForRepo(repo, { WT_HOOK_RUNNING: '1' }) });
    expect(r.status).not.toBe(0);
    expect(commitCount(repo)).toBe(0);
  });
});

describe('Conventional commits gating', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  test('conventional commit decisions and bypass', () => {
    writeFileSync(join(repo, 'a.txt'), 'a');
    git(repo, 'add', 'a.txt');
    const clean = git(repo, 'commit', '-m', 'feat: clean commit message', { env: envForRepo(repo) });
    expect(clean.status, output(clean)).toBe(0);

    writeFileSync(join(repo, 'b.txt'), 'b');
    git(repo, 'add', 'b.txt');
    const blocked = git(repo, 'commit', '-m', 'no convention here', { env: envForRepo(repo) });
    expect(blocked.status).not.toBe(0);

    const bypassRepo = newRepo();
    try {
      writeFileSync(join(bypassRepo, 'c.txt'), 'c');
      git(bypassRepo, 'add', 'c.txt');
      const bypass = git(bypassRepo, 'commit', '-m', 'bad', { env: envForRepo(bypassRepo, { SKIP_COMMITLINT: '1' }) });
      expect(bypass.status).toBe(0);
    } finally {
      cleanup(bypassRepo);
    }
  });
});

describe('Lifecycle commands', () => {
  let repo: string;

  afterEach(() => cleanup(repo));

  test('install writes owned hooks and sets local core.hooksPath', () => {
    repo = newBareRepo();
    const r = run(GIT_GUARDRAILS, ['install'], { cwd: repo, env: envForRepo(repo) });
    expect(r.status).toBe(0);

    const dir = hooksDir(repo);
    expect(git(repo, 'config', '--local', '--get', 'core.hooksPath').stdout.trim()).toBe(dir);
    for (const hook of ['pre-commit', 'pre-push', 'commit-msg']) {
      expect(readFileSync(join(dir, hook), 'utf8')).toContain('# git-guardrails-managed: git-guardrails.v0');
    }
  });


  test('uninstall preserves non-ours hooks and keeps non-git-guardrails hooksPath', () => {
    repo = newBareRepo();
    const dir = join(repo, '.custom-hooks');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pre-commit'), '#!/usr/bin/env bash\necho custom\n');
    git(repo, 'config', '--local', 'core.hooksPath', '.custom-hooks');

    const r = run(GIT_GUARDRAILS, ['uninstall'], { cwd: repo, env: envForRepo(repo) });
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'pre-commit'), 'utf8')).toContain('echo custom');
    expect(git(repo, 'config', '--local', '--get', 'core.hooksPath').stdout.trim()).toBe('.custom-hooks');
  });

  test('uninstall removes owned hooks and unsets git-guardrails-owned hooksPath', () => {
    repo = newBareRepo();
    expect(run(GIT_GUARDRAILS, ['install'], { cwd: repo, env: envForRepo(repo) }).status).toBe(0);
    const dir = hooksDir(repo);

    const r = run(GIT_GUARDRAILS, ['uninstall'], { cwd: repo, env: envForRepo(repo) });
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, 'pre-commit'))).toBe(false);
    expect(git(repo, 'config', '--local', '--get', 'core.hooksPath').status).not.toBe(0);
  });





  test('install --force replaces a conflicting hook', () => {
    repo = newBareRepo();
    const dir = hooksDir(repo);
    writeFileSync(join(dir, 'pre-commit'), '#!/usr/bin/env bash\necho external\n');

    const refused = run(GIT_GUARDRAILS, ['install'], { cwd: repo, env: envForRepo(repo) });
    expect(refused.stdout + refused.stderr).toContain('conflicts: 1');

    const forced = run(GIT_GUARDRAILS, ['install', '--force'], { cwd: repo, env: envForRepo(repo) });
    expect(forced.status).toBe(0);
    expect(readFileSync(join(dir, 'pre-commit'), 'utf8')).toContain('# git-guardrails-managed: git-guardrails.v0');
  });

  test('install --skip excludes requested hook', () => {
    repo = newBareRepo();
    const r = run(GIT_GUARDRAILS, ['install', '--skip', 'pre-push'], { cwd: repo, env: envForRepo(repo) });
    expect(r.status).toBe(0);

    const dir = hooksDir(repo);
    expect(existsSync(join(dir, 'pre-commit'))).toBe(true);
    expect(existsSync(join(dir, 'pre-push'))).toBe(false);
    expect(existsSync(join(dir, 'commit-msg'))).toBe(true);
  });


  test('doctor current repo renders structured detail', () => {
    repo = newBareRepo();
    expect(run(GIT_GUARDRAILS, ['install'], { cwd: repo, env: envForRepo(repo) }).status).toBe(0);

    const r = run(GIT_GUARDRAILS, ['doctor'], { cwd: repo, env: envForRepo(repo) });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('category');
    expect(r.stdout).toContain('installed');
    expect(r.stdout).toContain('pre-commit');
    expect(r.stdout).toContain('installed (git-guardrails)');
  });

  test('doctor --all summary agrees with current repo classification', () => {
    repo = newBareRepo();
    expect(run(GIT_GUARDRAILS, ['install'], { cwd: repo, env: envForRepo(repo) }).status).toBe(0);

    const current = run(GIT_GUARDRAILS, ['doctor'], { cwd: repo, env: envForRepo(repo) });
    const all = run(GIT_GUARDRAILS, ['doctor', '--all', '--root', repo], { env: envForRepo(repo) });

    expect(current.status).toBe(0);
    expect(all.status).toBe(0);
    expect(current.stdout).toContain('category');
    expect(current.stdout).toContain('installed');
    expect(all.stdout).toContain('1 installed');
    expect(all.stdout).toContain(repo);
  });

  test('doctor --all preserves repo paths containing spaces', () => {
    const scanRoot = mkdtempSync(join(tmpdir(), 'git-guardrails-spaces-'));
    try {
      const spaceParent = join(scanRoot, 'My Projects');
      const spaceRepo = join(spaceParent, 'foo');
      const configHome = join(scanRoot, 'xdg');
      mkdirSync(spaceRepo, { recursive: true });
      mkdirSync(configHome, { recursive: true });
      git(spaceRepo, 'init', '-q', '-b', 'main');
      git(spaceRepo, 'config', 'user.email', 'test@example.com');
      git(spaceRepo, 'config', 'user.name', 'git-guardrails-test');
      expect(run(GIT_GUARDRAILS, ['install', '--force'], { cwd: spaceRepo, env: testEnv(configHome) }).status).toBe(0);

      const r = run(GIT_GUARDRAILS, ['doctor', '--all', '--root', scanRoot], { env: testEnv(configHome) });
      const expected = 'My Projects/foo';
      expect(r.status).toBe(0);
      expect((r.stdout.match(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBe(1);
      expect(r.stdout).toContain('1 installed');
    } finally {
      cleanup(scanRoot);
    }
  });

  test('doctor --all bypass guidance emits blocking compose snippet', () => {
    const scanRoot = mkdtempSync(join(tmpdir(), 'git-guardrails-bypass-'));
    try {
      const bypassRepo = join(scanRoot, 'bypass');
      const configHome = join(scanRoot, 'xdg');
      mkdirSync(join(bypassRepo, '.custom-hooks'), { recursive: true });
      mkdirSync(configHome, { recursive: true });
      git(bypassRepo, 'init', '-q', '-b', 'main');
      git(bypassRepo, 'config', 'user.email', 'test@example.com');
      git(bypassRepo, 'config', 'user.name', 'git-guardrails-test');
      git(bypassRepo, 'config', '--local', 'core.hooksPath', '.custom-hooks');

      const r = run(GIT_GUARDRAILS, ['doctor', '--all', '--root', scanRoot], { env: testEnv(configHome) });

      expect(r.status).toBe(0);
      expect(r.stdout).toContain('bypass-other');
      expect(r.stdout).toContain('git-guardrails run <hook> "$@" || exit $?');
      expect(r.stdout).not.toContain('git-guardrails run <hook> "$@" || true');
    } finally {
      cleanup(scanRoot);
    }
  });

  test('global-template generate writes init template and configures git', () => {
    repo = newBareRepo();
    const home = mkdtempSync(join(tmpdir(), 'git-guardrails-home-'));
    const dataHome = join(repo, 'xdg-data');
    const env = { ...envForRepo(repo), HOME: home, XDG_DATA_HOME: dataHome };

    const r = run(GIT_GUARDRAILS, ['global-template', 'generate'], { cwd: repo, env });
    expect(r.status).toBe(0);

    const templateDir = join(dataHome, 'git-guardrails', 'git-template');
    expect(run('git', ['config', '--global', '--get', 'init.templateDir'], { env }).stdout.trim()).toBe(templateDir);
    for (const hook of ['pre-commit', 'pre-push', 'commit-msg']) {
      expect(readFileSync(join(templateDir, 'hooks', hook), 'utf8')).toContain('# git-guardrails-managed: git-guardrails.v0');
    }
    cleanup(home);
  });
});

describe('Doctor handles worktrees correctly', () => {
  let scanRoot: string;
  let parent: string;
  let wt: string;
  let parentCanonical: string;
  let wtCanonical: string;
  beforeEach(() => {
    // Use a shared scan root containing both parent repo and worktree.
    scanRoot = mkdtempSync(join(tmpdir(), 'git-guardrails-doctor-'));
    parent = join(scanRoot, 'parent');
    mkdirSync(parent);
    git(parent, 'init', '-q', '-b', 'main');
    git(parent, 'config', 'user.email', 't@e.com');
    git(parent, 'config', 'user.name', 't');
    writeFileSync(join(parent, 'x'), 'x');
    git(parent, 'add', 'x');
    git(parent, 'commit', '-q', '-m', 'feat: init');
    const configHome = join(scanRoot, 'xdg');
    mkdirSync(configHome, { recursive: true });
    const install = run(GIT_GUARDRAILS, ['install', '--force'], { cwd: parent, env: testEnv(configHome) });
    expect(install.status).toBe(0);
    git(parent, 'branch', 'other');
    wt = join(scanRoot, 'wt');
    git(parent, 'worktree', 'add', wt, 'other');

    parentCanonical = git(parent, 'rev-parse', '--show-toplevel').stdout.trim();
    wtCanonical = git(wt, 'rev-parse', '--show-toplevel').stdout.trim();
  });
  afterEach(() => {
    cleanup(scanRoot);
  });

  test('worktree (with .git file, not directory) is detected as enrolled', () => {
    const r = run(GIT_GUARDRAILS, ['doctor', '--all', '--root', scanRoot], { env: testEnv(join(scanRoot, 'xdg')) });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('2 repos');
    expect(r.stdout).toContain('  ✓ parent');
    expect(r.stdout).toContain('  ✓ wt');
    expect(r.stdout).toContain('2 installed');
  });
});

describe('universal checks registry', () => {
  type RegistryEntry = {
    hook: string;
    command: string;
    skipEnv: string;
    requiredTools: string;
    rationale: string;
  };

  function registryEntries(): RegistryEntry[] {
    const r = run('bash', ['-c', 'source checks/registry.sh; printf "%s\\n" "${GIT_GUARDRAILS_CHECKS[@]}"'], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    return r.stdout.trim().split('\n').filter(Boolean).map((line) => {
      const fields = line.split('|');
      expect(fields.length, line).toBe(5);
      const [hook, command, skipEnv, requiredTools, rationale] = fields;
      return { hook, command, skipEnv, requiredTools, rationale };
    });
  }

  function registryTools(arrayName: 'GIT_GUARDRAILS_REQUIRED_TOOLS' | 'GIT_GUARDRAILS_OPTIONAL_TOOLS'): string[] {
    const r = run('bash', ['-c', `source checks/registry.sh; printf "%s\\n" "\${${arrayName}[@]}"`], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    return r.stdout.trim().split('\n').filter(Boolean);
  }

  test('registry loads cleanly', () => {
    const r = run('bash', ['-c', 'source checks/registry.sh; declare -p GIT_GUARDRAILS_CHECKS'], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('GIT_GUARDRAILS_CHECKS');
  });

  test('every registry entry has five non-empty fields', () => {
    for (const entry of registryEntries()) {
      expect(entry.hook).toMatch(/^(pre-commit|commit-msg|pre-push)$/);
      expect(entry.command.length).toBeGreaterThan(0);
      expect(entry.skipEnv).toMatch(/^SKIP_[A-Z0-9_]+$/);
      expect(entry.requiredTools.length).toBeGreaterThan(0);
      expect(entry.rationale.length).toBeGreaterThan(0);
    }
  });

  test('lefthook skip env surface matches registry', () => {
    const lefthook = readFileSync(join(REPO_ROOT, 'lefthook.yml'), 'utf8');
    const registrySkipEnvs = new Set(registryEntries().map((entry) => entry.skipEnv));
    const lefthookSkipEnvs = new Set([...lefthook.matchAll(/SKIP_[A-Z0-9_]+/g)].map((match) => match[0]));

    for (const skipEnv of registrySkipEnvs) {
      expect(lefthookSkipEnvs.has(skipEnv), `${skipEnv} missing from lefthook.yml`).toBe(true);
    }
    for (const skipEnv of lefthookSkipEnvs) {
      if (skipEnv === 'SKIP_<CHECK>') continue;
      expect(registrySkipEnvs.has(skipEnv), `${skipEnv} not present in registry`).toBe(true);
    }
  });

  test('required registry tools are reachable in CI', () => {
    for (const tool of registryTools('GIT_GUARDRAILS_REQUIRED_TOOLS')) {
      const r = run('bash', ['-c', `source "${GIT_GUARDRAILS}"; have "$1"`, 'bash', tool], {
        cwd: REPO_ROOT,
        env: testEnv(mkdtempSync(join(tmpdir(), 'git-guardrails-xdg-'))),
      });
      expect(r.status, tool).toBe(0);
    }
  });

  test('doctor reachability output matches registry tool list', () => {
    const repo = newBareRepo();
    try {
      const r = run(GIT_GUARDRAILS, ['doctor'], { cwd: repo, env: envForRepo(repo) });
      expect(r.status).toBe(0);
      for (const tool of [...registryTools('GIT_GUARDRAILS_REQUIRED_TOOLS'), ...registryTools('GIT_GUARDRAILS_OPTIONAL_TOOLS')]) {
        expect(r.stdout, tool).toContain(`${tool} reachable`);
      }
    } finally {
      cleanup(repo);
    }
  });

  test('registry does not ship repo-owned language gates by default', () => {
    const commands = new Set(registryEntries().map((entry) => entry.command));
    const optionalTools = new Set(registryTools('GIT_GUARDRAILS_OPTIONAL_TOOLS'));

    // ADR-008: the criterion is the verdict, not the engine. python-bugs may
    // shell out to ruff via uvx because it runs --isolated over a fixed rule
    // set; a `ruff` check that reads the repo's rule set is what stays out.
    for (const repoOwnedGate of ['ruff', 'ty', 'biome', 'vulture', 'radon', 'import-linter']) {
      expect(commands.has(repoOwnedGate), repoOwnedGate).toBe(false);
      expect(optionalTools.has(repoOwnedGate), repoOwnedGate).toBe(false);
    }
  });
});


describe('hook classifier', () => {
  let repo: string;

  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  function hooksDir(): string {
    return git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').stdout.trim() + '/hooks';
  }

  function classify(hook: string, env: NodeJS.ProcessEnv = envForRepo(repo)): SpawnResult {
    return run('bash', ['-c', `source "${GIT_GUARDRAILS}"; _classify_hook "${hooksDir()}" "${hook}"`], { cwd: repo, env });
  }

  test('absent', () => {
    rmSync(join(hooksDir(), 'pre-commit'), { force: true });
    expect(classify('pre-commit').stdout.trim()).toBe('absent');
  });

  test('ours', () => {
    expect(classify('pre-commit').stdout.trim()).toBe('ours');
  });

  test('non-ours', () => {
    writeFileSync(join(hooksDir(), 'pre-commit'), '#!/usr/bin/env bash\necho external\n');
    expect(classify('pre-commit').stdout.trim()).toBe('non-ours');
  });



  test('opt-out', () => {
    const optOutDir = join(repo, 'xdg', 'git-guardrails');
    mkdirSync(optOutDir, { recursive: true });
    const canonical = git(repo, 'rev-parse', '--show-toplevel').stdout.trim();
    writeFileSync(join(optOutDir, '.opt-out'), `${canonical}\n`);
    expect(classify('pre-commit').stdout.trim()).toBe('opt-out');
  });

  test('shadowed by local core.hooksPath', () => {
    git(repo, 'config', '--local', 'core.hooksPath', '.custom-hooks');
    expect(classify('pre-commit').stdout.trim()).toBe('shadowed');
  });

  test('shadowed by global core.hooksPath', () => {
    const home = mkdtempSync(join(tmpdir(), 'git-guardrails-home-'));
    git(repo, 'config', '--local', '--unset', 'core.hooksPath');
    run('git', ['config', '--global', 'core.hooksPath', '.global-hooks'], { env: { ...envForRepo(repo), HOME: home } });
    expect(classify('pre-commit', { ...envForRepo(repo), HOME: home }).stdout.trim()).toBe('shadowed');
    cleanup(home);
  });
});

describe('compose snippets', () => {
  function compose(hook: string, mode: string): SpawnResult {
    return run('bash', ['-c', `source "${GIT_GUARDRAILS}"; _compose_snippet "$1" "$2"`, 'bash', hook, mode], {
      env: testEnv(mkdtempSync(join(tmpdir(), 'git-guardrails-xdg-'))),
    });
  }

  test('standalone commit-msg forwards hook arguments', () => {
    const r = compose('commit-msg', 'standalone');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('exec git-guardrails run commit-msg "$@"');
  });

  test('embedded pre-push preserves stdin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-guardrails-compose-'));
    try {
      const bin = join(dir, 'git-guardrails');
      const stdinFile = join(dir, 'stdin');
      const argsFile = join(dir, 'args');
      writeFileSync(bin, `#!/usr/bin/env bash
printf '%s\\n' "$*" > "${argsFile}"
cat > "${stdinFile}"
exit "\${FAKE_GIT_GUARDRAILS_STATUS:-0}"
`);
      chmodSync(bin, 0o755);

      const snippet = compose('pre-push', 'embedded').stdout;
      const stdin = 'refs/heads/main 111 refs/heads/main 000\n';
      const r = run('bash', ['-c', snippet, 'hook-shell', 'remote', 'url'], {
        input: stdin,
        env: { ...testEnv(join(dir, 'xdg')), PATH: `${dir}:${process.env.PATH ?? ''}` },
      });

      expect(r.status).toBe(0);
      expect(readFileSync(argsFile, 'utf8')).toBe('run pre-push remote url\n');
      expect(readFileSync(stdinFile, 'utf8')).toBe(stdin);
    } finally {
      cleanup(dir);
    }
  });

  test('embedded mode propagates non-zero git-guardrails status', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-guardrails-compose-'));
    try {
      const bin = join(dir, 'git-guardrails');
      writeFileSync(bin, `#!/usr/bin/env bash
exit "\${FAKE_GIT_GUARDRAILS_STATUS:-0}"
`);
      chmodSync(bin, 0o755);

      const snippet = compose('pre-commit', 'embedded').stdout;
      const r = run('bash', ['-c', `${snippet}
echo unreachable`], {
        env: {
          ...testEnv(join(dir, 'xdg')),
          PATH: `${dir}:${process.env.PATH ?? ''}`,
          FAKE_GIT_GUARDRAILS_STATUS: '17',
        },
      });

      expect(r.status).toBe(17);
      expect(r.stdout).not.toContain('unreachable');
    } finally {
      cleanup(dir);
    }
  });

  test('bypass-help emits a single pastable shell line', () => {
    const r = compose('pre-commit', 'bypass-help');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('SKIP_LARGE_FILES=1 SKIP_GITLEAKS=1 SKIP_ACTIONLINT=1 SKIP_PYTHON_BUGS=1 git-guardrails run pre-commit "$@" || true');
    expect(r.stdout.trim()).not.toContain('\n');
    expect(run('bash', ['-n'], { input: r.stdout }).status).toBe(0);
  });

  test('documentation uses canonical embedded shell snippets', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const perRepoHooks = readFileSync(join(REPO_ROOT, 'docs/PER_REPO_HOOKS.md'), 'utf8');
    for (const hook of ['pre-commit', 'pre-push']) {
      const snippet = compose(hook, 'embedded').stdout.trim();
      expect(readme).toContain(snippet);
      expect(perRepoHooks).toContain(snippet);
    }
  });

  test('invalid compose mode returns non-zero', () => {
    const r = compose('pre-commit', 'bogus');
    expect(r.status).not.toBe(0);
  });
});
