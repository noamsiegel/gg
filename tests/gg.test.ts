import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GG = join(ROOT, 'gg');
const CHECKS = join(ROOT, 'checks');
const STRIPE_SECRET = ['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dc'].join('_');
const repos: string[] = [];

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[] = [], options: SpawnSyncOptions = {}): Result {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    status: result.status,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  };
}

function combined(result: Result): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function git(repo: string, ...args: string[]): Result {
  return run('git', args, { cwd: repo, env: testEnv() });
}

function testEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'gg test',
    GIT_AUTHOR_EMAIL: 'gg@example.test',
    GIT_COMMITTER_NAME: 'gg test',
    GIT_COMMITTER_EMAIL: 'gg@example.test',
    NO_COLOR: '1',
    ...extra,
  };
}

function newRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'gg-test-'));
  repos.push(repo);
  expect(git(repo, 'init', '-q', '-b', 'main').status).toBe(0);
  expect(git(repo, 'config', 'core.hooksPath', '/dev/null').status).toBe(0);
  return repo;
}

function write(repo: string, path: string, contents: string | Buffer): void {
  const target = join(repo, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function commit(repo: string, message = 'fixture'): string {
  expect(git(repo, 'add', '-A').status).toBe(0);
  const result = git(repo, 'commit', '-q', '-m', message);
  expect(result.status, combined(result)).toBe(0);
  return git(repo, 'rev-parse', 'HEAD').stdout.trim();
}

function gg(repo: string, args: string[] = [], options: SpawnSyncOptions = {}): Result {
  return run(GG, args, { cwd: repo, env: testEnv(), ...options });
}

function isolatedGg(checks: Record<string, string>): string {
  const harness = mkdtempSync(join(tmpdir(), 'gg-isolated-'));
  repos.push(harness);
  const executable = join(harness, 'gg');
  cpSync(GG, executable);
  chmodSync(executable, 0o755);
  mkdirSync(join(harness, 'checks'));
  for (const [name, contents] of Object.entries(checks)) {
    const check = join(harness, 'checks', name);
    writeFileSync(check, contents);
    chmodSync(check, 0o755);
  }
  return executable;
}

function commandExists(command: string): boolean {
  return run('/bin/sh', ['-c', `command -v ${command}`]).status === 0;
}

function directCheck(repo: string, name: string, files: string, extra: NodeJS.ProcessEnv = {}): Result {
  return run(join(CHECKS, `${name}.sh`), [], {
    cwd: repo,
    env: testEnv({ GG_ROOT: repo, GG_INVOKE_DIR: repo, GG_BASE: '', GG_RANGE: '', GG_LOCAL_REF: '', GG_MODE: 'paths', GG_FILES: files, ...extra }),
  });
}

function snapshot(repo: string, directory = repo): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(directory)) {
    if (name === '.git') continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      for (const child of snapshot(repo, path)) entries.push(`${name}/${child}`);
    } else {
      entries.push(name);
    }
  }
  return entries.sort();
}

afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

describe('advisory and repository safety contracts', () => {
  test('advisory review reports a finding but exits zero', () => {
    const repo = newRepo();
    write(repo, 'base.txt', 'base\n');
    commit(repo);
    write(repo, 'large.bin', Buffer.alloc(6 * 1024 * 1024));
    git(repo, 'add', 'large.bin');

    const result = gg(repo, ['large.bin']);

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('large.bin');
    expect(result.stdout).toContain('large-files');
  });

  test('review leaves files, index, worktree, and local hooksPath unchanged', () => {
    const repo = newRepo();
    write(repo, 'clean.py', 'value = 1\n');
    commit(repo);
    const beforeFiles = snapshot(repo);
    const beforeHooks = git(repo, 'config', '--local', '--get', 'core.hooksPath').stdout;

    const result = gg(repo, ['clean.py']);

    expect(result.status, combined(result)).toBe(0);
    expect(snapshot(repo)).toEqual(beforeFiles);
    expect(git(repo, 'status', '--porcelain').stdout).toBe('');
    expect(git(repo, 'config', '--local', '--get', 'core.hooksPath').stdout).toBe(beforeHooks);
  });
});

describe('file-set and base selection', () => {
  test.skipIf(!commandExists('uvx'))('staged, since, and path modes select different files', () => {
    const repo = newRepo();
    write(repo, 'since.py', 'value = 1\n');
    write(repo, 'path.py', 'value = 1\n');
    const base = commit(repo, 'base');
    write(repo, 'since.py', 'print(missing_since)\n');
    commit(repo, 'range change');
    write(repo, 'staged.py', 'print(missing_staged)\n');
    git(repo, 'add', 'staged.py');
    write(repo, 'path.py', 'print(missing_path)\n');

    const staged = gg(repo, ['--staged']);
    const since = gg(repo, ['--since', base]);
    const paths = gg(repo, ['path.py']);

    expect(staged.stdout).toContain('staged.py');
    expect(staged.stdout).not.toContain('missing_since');
    expect(since.stdout).toContain('since.py');
    expect(since.stdout).toContain('staged.py');
    expect(since.stdout).toContain('path.py');
    expect(paths.stdout).toContain('path.py');
    expect(paths.stdout).not.toContain('staged.py');
  });

  test('staged pathspecs are Git-scoped relative to the invocation directory', () => {
    const repo = newRepo();
    write(repo, 'base.txt', 'base\n');
    commit(repo);
    write(repo, 'apps/hoa/inside.txt', 'inside\n');
    write(repo, 'apps/other/outside.txt', 'outside\n');
    expect(git(repo, 'add', 'apps/hoa/inside.txt', 'apps/other/outside.txt').status).toBe(0);
    const capture = join(repo, 'captured-files');
    const executable = isolatedGg({
      'capture.sh': '#!/usr/bin/env bash\n# gg-globs: *\nprintf \'%s\' "$GG_FILES" >"$GG_CAPTURE"\n',
    });

    const scoped = run(executable, ['--staged', '--', '.'], {
      cwd: join(repo, 'apps/hoa'),
      env: testEnv({ GG_CAPTURE: capture }),
    });

    expect(scoped.status, combined(scoped)).toBe(0);
    expect(readFileSync(capture, 'utf8')).toBe('apps/hoa/inside.txt');

    const unfiltered = run(executable, ['--staged'], {
      cwd: repo,
      env: testEnv({ GG_CAPTURE: capture }),
    });

    expect(unfiltered.status, combined(unfiltered)).toBe(0);
    expect(readFileSync(capture, 'utf8')).toBe('apps/hoa/inside.txt\napps/other/outside.txt');
  });

  test('separator forms reject missing pathspecs and unseparated trailing arguments', () => {
    const repo = newRepo();
    const malformed = [
      { args: ['--staged', '--'], message: '--staged requires at least one pathspec after --' },
      { args: ['--staged', 'apps/hoa'], message: '--staged pathspecs must follow --' },
      { args: ['guard', 'pre-push', '--'], message: 'guard pre-push requires at least one pathspec after --' },
      { args: ['guard', 'pre-push', 'apps/hoa'], message: 'guard pre-push pathspecs must follow --' },
    ];

    for (const { args, message } of malformed) {
      const result = gg(repo, args);
      expect(result.status, combined(result)).toBe(1);
      expect(result.stderr).toContain(message);
    }
  });

  test('origin/HEAD symbolic ref wins base resolution', () => {
    const repo = newRepo();
    write(repo, 'one.txt', 'one\n');
    commit(repo, 'one');
    write(repo, 'two.txt', 'two\n');
    const second = commit(repo, 'two');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/main', second).status).toBe(0);
    expect(git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main').status).toBe(0);
    write(repo, 'three.txt', 'three\n');
    commit(repo, 'three');

    const result = gg(repo);

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('branch vs origin/main');
    expect(result.stdout).toContain('(1 file)');
  });

  test('HEAD~1 is fallback when no remote exists', () => {
    const repo = newRepo();
    write(repo, 'one.txt', 'one\n');
    commit(repo, 'one');
    write(repo, 'two.txt', 'two\n');
    commit(repo, 'two');

    const result = gg(repo);

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('branch vs HEAD~1');
    expect(result.stdout).toContain('(1 file)');
  });

  test('single-commit repository with no base exits cleanly', () => {
    const repo = newRepo();
    write(repo, 'only.txt', 'only\n');
    commit(repo);

    const result = gg(repo);

    expect(result.status, combined(result)).toBe(0);
    expect(combined(result)).toContain('no base ref could be resolved');
  });
});

describe('dispatch and check protocol', () => {
  test('non-matching checks are not invoked and render no section', () => {
    const repo = newRepo();
    write(repo, 'README.txt', 'text only\n');
    commit(repo);

    const result = gg(repo, ['README.txt']);

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).not.toContain('python-bugs');
    expect(result.stdout).not.toContain('dead-code');
    expect(result.stdout).not.toContain('complexity');
    expect(result.stdout).not.toContain('architecture');
    expect(result.stdout).not.toContain('js-health');
  });

  test('exit 2 is rendered as skipped with reason while other nonzero is error', () => {
    const repo = newRepo();
    write(repo, 'sample.x', 'x\n');
    commit(repo);
    const harness = mkdtempSync(join(tmpdir(), 'gg-protocol-'));
    repos.push(harness);
    cpSync(GG, join(harness, 'gg'));
    chmodSync(join(harness, 'gg'), 0o755);
    mkdirSync(join(harness, 'checks'));
    writeFileSync(join(harness, 'checks', 'a-skip.sh'), '#!/usr/bin/env bash\n# gg-globs: *.x\necho "runner intentionally absent"\nexit 2\n');
    writeFileSync(join(harness, 'checks', 'b-error.sh'), '#!/usr/bin/env bash\n# gg-globs: *.x\necho "analysis crashed"\nexit 7\n');

    const result = run(join(harness, 'gg'), ['sample.x'], { cwd: repo, env: testEnv() });

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('a-skip\n  (skipped: runner intentionally absent)');
    expect(result.stdout).toContain('b-error\n  (error: analysis crashed)');
    expect(result.stdout).not.toContain('skipped: analysis crashed');
  });

  test('missing external runners degrade to explicit skips', () => {
    const repo = newRepo();
    write(repo, 'app.py', 'print(missing)\n');
    write(repo, 'app.ts', 'const x = 1;\n');
    commit(repo);
    const bin = mkdtempSync(join(tmpdir(), 'gg-path-'));
    repos.push(bin);
    for (const tool of ['git', 'bash', 'sed', 'sort', 'find', 'wc', 'tr', 'dirname', 'realpath']) {
      const source = run('/bin/sh', ['-c', `command -v ${tool}`]).stdout.trim();
      if (source) Bun.spawnSync(['ln', '-s', source, join(bin, tool)]);
    }

    const result = gg(repo, ['app.py', 'app.ts'], { env: testEnv({ PATH: bin }) });

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout.includes('uvx is required') || result.stdout.includes('uvx required')).toBe(true);
    expect(result.stdout).toContain('npx is not available');
    expect(result.stdout).toContain('gitleaks is not available');
    expect(result.stdout).not.toContain('(error:');
  });
});

describe('blocking guard and secrets regression coverage', () => {
  test.skipIf(!commandExists('gitleaks'))('pre-push parses the space-separated ref line and blocks a live secret', () => {
    const repo = newRepo();
    write(repo, 'safe.txt', 'safe\n');
    const base = commit(repo, 'safe');
    write(repo, 'secret.ts', `export const token = '${STRIPE_SECRET}';\n`);
    const head = commit(repo, 'secret');
    const line = `refs/heads/main ${head} refs/heads/main ${base}\n`;

    const result = gg(repo, ['guard', 'pre-push'], { input: line });

    expect(result.status, combined(result)).not.toBe(0);
    expect(result.stdout).toContain('secret.ts');
  });


  test.skipIf(!commandExists('gitleaks'))('secrets check finds a known leak and stays silent for a clean range', () => {
    const repo = newRepo();
    write(repo, 'base.txt', 'safe\n');
    const base = commit(repo, 'base');
    write(repo, 'secret.ts', `export const token = '${STRIPE_SECRET}';\n`);
    const leakHead = commit(repo, 'leak');

    const leak = directCheck(repo, 'secrets', 'secret.ts', { GG_BASE: base, GG_RANGE: `${base}..${leakHead}`, GG_MODE: 'range' });
    expect(leak.status, combined(leak)).toBe(0);
    expect(leak.stdout).toContain('secret.ts');

    write(repo, 'clean.ts', 'export const answer = 42;\n');
    const cleanHead = commit(repo, 'clean');
    const clean = directCheck(repo, 'secrets', 'clean.ts', { GG_BASE: leakHead, GG_RANGE: `${leakHead}..${cleanHead}`, GG_MODE: 'range' });
    expect(clean.status, combined(clean)).toBe(0);
    expect(clean.stdout).toBe('');
  });

  test.skipIf(!commandExists('gitleaks'))('first push of a new branch is scanned, not skipped', () => {
    // Regression: a new branch sends an all-zero remote sha. The guard used to
    // fall back to a resolved base ref, and in a fresh repository no base
    // resolves at all - so the very first push of a repository skipped the
    // secret scan entirely and published the leak. The range for a new branch
    // is everything no remote already has, not a diff against some base.
    const repo = newRepo();
    write(repo, 'secret.ts', `export const token = '${STRIPE_SECRET}';\n`);
    const head = commit(repo, 'initial');
    const zeros = '0'.repeat(40);
    const line = `refs/heads/main ${head} refs/heads/main ${zeros}\n`;

    const result = gg(repo, ['guard', 'pre-push'], { input: line });

    expect(result.status, combined(result)).not.toBe(0);
    expect(result.stdout).toContain('secret.ts');
    expect(combined(result)).not.toContain('no base ref could be resolved');
  });

  test('a clean new branch still runs the guard rather than skipping it', () => {
    const repo = newRepo();
    write(repo, 'safe.txt', 'safe\n');
    const head = commit(repo, 'initial');
    const zeros = '0'.repeat(40);

    const result = gg(repo, ['guard', 'pre-push'], { input: `refs/heads/main ${head} refs/heads/main ${zeros}\n` });

    expect(result.status, combined(result)).toBe(0);
    // Proves the ref was actually examined. An early `continue` would also exit
    // 0, which is exactly how the original hole stayed invisible.
    expect(result.stdout).toContain('guard pre-push');
  });

  test.skipIf(!commandExists('gitleaks'))('merging an upstream branch forward does not scan upstream commits', () => {
    // Regression: the existing-branch range was `$remote_sha..$local_sha`, which is
    // everything the push adds to THAT branch. Merging origin/main forward therefore
    // dragged every upstream commit into the scan, and a finding in someone else's
    // already-merged file blocked the push. The only escape is --no-verify, which
    // disables the real secret check too - a guard that trains people to bypass it.
    const repo = newRepo();
    write(repo, 'safe.txt', 'safe\n');
    const root = commit(repo, 'initial');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/main', root).status).toBe(0);

    // Upstream lands a commit carrying a secret, and it is already published.
    expect(git(repo, 'checkout', '-q', '-b', 'upstream').status).toBe(0);
    write(repo, 'theirs.ts', `export const token = '${STRIPE_SECRET}';\n`);
    const upstream = commit(repo, 'upstream secret');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/main', upstream).status).toBe(0);

    // Our branch, pushed once, then merges upstream forward and adds its own clean
    // file. The own file matters: it keeps the scan non-empty, so the header proves
    // the ref was really examined while the upstream secret was excluded. A pure
    // merge with no own changes contributes no files at all and is skipped silently,
    // which would make this assertion vacuous.
    expect(git(repo, 'checkout', '-q', '-b', 'mine', root).status).toBe(0);
    write(repo, 'mine.txt', 'mine\n');
    const mineFirst = commit(repo, 'mine');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/mine', mineFirst).status).toBe(0);
    expect(git(repo, 'merge', '--no-edit', 'upstream').status).toBe(0);
    write(repo, 'ours-clean.txt', 'no secrets here\n');
    const merged = commit(repo, 'mine after merge');

    const line = `refs/heads/mine ${merged} refs/heads/mine ${mineFirst}\n`;
    const result = gg(repo, ['guard', 'pre-push'], { input: line });

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).not.toContain('theirs.ts');
    // Proves the ref was examined rather than skipped, which would also exit 0.
    expect(result.stdout).toContain('guard pre-push');
  });

  test.skipIf(!commandExists('gitleaks'))('a secret in our own commit still blocks after a forward merge', () => {
    // The counterpart: narrowing the range must not stop scanning what we wrote.
    const repo = newRepo();
    write(repo, 'safe.txt', 'safe\n');
    const root = commit(repo, 'initial');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/main', root).status).toBe(0);
    expect(git(repo, 'checkout', '-q', '-b', 'upstream').status).toBe(0);
    write(repo, 'theirs.txt', 'upstream change\n');
    const upstream = commit(repo, 'upstream');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/main', upstream).status).toBe(0);

    expect(git(repo, 'checkout', '-q', '-b', 'mine', root).status).toBe(0);
    write(repo, 'mine.txt', 'mine\n');
    const mineFirst = commit(repo, 'mine');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/mine', mineFirst).status).toBe(0);
    expect(git(repo, 'merge', '--no-edit', 'upstream').status).toBe(0);
    write(repo, 'ours.ts', `export const token = '${STRIPE_SECRET}';\n`);
    const withSecret = commit(repo, 'our secret');

    const line = `refs/heads/mine ${withSecret} refs/heads/mine ${mineFirst}\n`;
    const result = gg(repo, ['guard', 'pre-push'], { input: line });

    expect(result.status, combined(result)).not.toBe(0);
    expect(result.stdout).toContain('ours.ts');
  });
});

  test('pre-push pathspecs scope exact check files while the old form stays unfiltered', () => {
    const repo = newRepo();
    write(repo, 'apps/hoa/inside.txt', 'base\n');
    write(repo, 'apps/other/outside.txt', 'base\n');
    const base = commit(repo, 'base');
    write(repo, 'apps/hoa/inside.txt', 'changed\n');
    write(repo, 'apps/other/outside.txt', 'changed\n');
    const head = commit(repo, 'mixed change');
    const capture = join(repo, 'captured-files');
    const executable = isolatedGg({
      'secrets.sh': [
        '#!/usr/bin/env bash',
        '# gg-globs: *',
        'printf \'%s\' "$GG_FILES" >"$GG_CAPTURE"',
        'case "$GG_FILES" in',
        '  *outside.txt*) printf \'outside path blocked\\n\' ;;',
        'esac',
        '',
      ].join('\n'),
    });
    const input = `refs/heads/main ${head} refs/heads/main ${base}\n`;

    const scoped = run(executable, ['guard', 'pre-push', '--', '.'], {
      cwd: join(repo, 'apps/hoa'),
      env: testEnv({ GG_CAPTURE: capture }),
      input,
    });

    expect(scoped.status, combined(scoped)).toBe(0);
    expect(readFileSync(capture, 'utf8')).toBe('apps/hoa/inside.txt');

    const unfiltered = run(executable, ['guard', 'pre-push'], {
      cwd: repo,
      env: testEnv({ GG_CAPTURE: capture }),
      input,
    });

    expect(unfiltered.status, combined(unfiltered)).toBe(1);
    expect(readFileSync(capture, 'utf8')).toBe('apps/hoa/inside.txt\napps/other/outside.txt');
  });

  test.skipIf(!commandExists('gitleaks'))('scoped guard ignores non-HOA secret history and blocks deleted HOA secret history', () => {
    const repo = newRepo();
    write(repo, 'apps/hoa/safe.txt', 'base\n');
    const base = commit(repo, 'base');
    write(repo, 'apps/hoa/safe.txt', 'changed\n');
    write(repo, 'apps/other/secret.ts', `export const token = '${STRIPE_SECRET}';\n`);
    commit(repo, 'outside secret');
    rmSync(join(repo, 'apps/other/secret.ts'));
    const outsideHead = commit(repo, 'delete outside secret');

    const outside = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `refs/heads/main ${outsideHead} refs/heads/main ${base}\n`,
    });

    expect(outside.status, combined(outside)).toBe(0);
    expect(outside.stdout).toContain('guard pre-push');

    const hoaSecret = "apps/hoa/secrét [prod]'s.ts";
    write(repo, hoaSecret, `export const token = '${STRIPE_SECRET}';\n`);
    commit(repo, 'HOA secret');
    rmSync(join(repo, hoaSecret));
    const hoaHead = commit(repo, 'delete HOA secret');

    const hoa = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `refs/heads/main ${hoaHead} refs/heads/main ${outsideHead}\n`,
    });

    expect(hoa.status, combined(hoa)).toBe(1);
    expect(hoa.stdout).toContain(hoaSecret);
  });

  test.skipIf(!commandExists('gitleaks'))('scoped guard does not rescan unchanged HOA secrets from the remote boundary', () => {
    const repo = newRepo();
    write(repo, 'apps/hoa/published-secret.ts', `export const token = '${STRIPE_SECRET}';\n`);
    const base = commit(repo, 'published secret');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/main', base).status).toBe(0);
    write(
      repo,
      'apps/hoa/published-secret.ts',
      `export const token = '${STRIPE_SECRET}';\nexport const safeChange = true;\n`,
    );
    write(repo, 'apps/hoa/safe.txt', 'new safe work\n');
    const head = commit(repo, 'safe HOA change');

    const result = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `refs/heads/main ${head} refs/heads/main ${base}\n`,
    });

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('guard pre-push');
    expect(result.stdout).not.toContain('published-secret.ts');
  });

  test.skipIf(!commandExists('gitleaks'))('unrelated annotated tags do not abort a clean scoped guard', () => {
    const repo = newRepo();
    write(repo, 'docs/unrelated.txt', 'tagged elsewhere\n');
    const base = commit(repo, 'unrelated base');
    expect(git(repo, 'tag', '-a', 'unrelated', '-m', 'unrelated tag', base).status).toBe(0);
    expect(git(repo, 'update-ref', 'refs/remotes/origin/main', base).status).toBe(0);
    write(repo, 'apps/hoa/safe.txt', 'safe\n');
    const head = commit(repo, 'safe HOA change');

    const result = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `refs/heads/main ${head} refs/heads/main ${base}\n`,
    });

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('guard pre-push');
  });

  test.skipIf(!commandExists('gitleaks'))('signed annotated tags are stripped in temporary scoped history', () => {
    const repo = newRepo();
    write(repo, 'base.txt', 'base\n');
    const base = commit(repo, 'base');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/main', base).status).toBe(0);
    write(repo, 'apps/hoa/safe.txt', 'safe\n');
    const head = commit(repo, 'safe HOA change');
    const tagObject = [
      `object ${head}`,
      'type commit',
      'tag synthetic-signed',
      'tagger gg test <gg@example.test> 1700000000 +0000',
      '',
      'synthetic signed tag',
      '-----BEGIN PGP SIGNATURE-----',
      'not-a-real-signature',
      '-----END PGP SIGNATURE-----',
      '',
    ].join('\n');
    const hashed = run('git', ['hash-object', '-t', 'tag', '-w', '--stdin'], {
      cwd: repo,
      env: testEnv(),
      input: tagObject,
    });
    expect(hashed.status, combined(hashed)).toBe(0);
    expect(git(repo, 'update-ref', 'refs/tags/synthetic-signed', hashed.stdout.trim()).status).toBe(0);

    const result = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `refs/heads/main ${head} refs/heads/main ${base}\n`,
    });

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('guard pre-push');
  });

  test.skipIf(!commandExists('gitleaks'))('existing export ref cannot redirect a scoped guard to different history', () => {
    const repo = newRepo();
    write(repo, 'base.txt', 'base\n');
    const base = commit(repo, 'base');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/main', base).status).toBe(0);
    write(repo, 'apps/hoa/safe.ts', 'export const safe = true;\n');
    const head = commit(repo, 'safe HOA change');
    const collisionRef = `refs/heads/gg-scope-${head}`;

    expect(git(repo, 'checkout', '-q', '-b', 'collision-work', base).status).toBe(0);
    write(repo, 'apps/hoa/safe.ts', `export const token = '${STRIPE_SECRET}';\n`);
    const collision = commit(repo, 'collision secret');
    expect(git(repo, 'update-ref', collisionRef, collision).status).toBe(0);
    expect(git(repo, 'checkout', '-q', 'main').status).toBe(0);
    expect(git(repo, 'branch', '-D', 'collision-work').status).toBe(0);

    const result = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `refs/heads/main ${head} refs/heads/main ${base}\n`,
    });

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('guard pre-push');
    expect(result.stdout).not.toContain('collision secret');
  });

  test.skipIf(!commandExists('gitleaks'))('annotated local tag rewrites a filtered target and still scans selected history', () => {
    const repo = newRepo();
    write(repo, 'apps/hoa/safe.txt', 'base\n');
    const base = commit(repo, 'base');
    expect(git(repo, 'update-ref', 'refs/remotes/origin/main', base).status).toBe(0);
    write(repo, 'apps/hoa/tagged-secret.ts', `export const token = '${STRIPE_SECRET}';\n`);
    commit(repo, 'tagged secret');
    expect(git(repo, 'commit', '--allow-empty', '-q', '-m', 'tag wrapper').status).toBe(0);
    expect(git(repo, 'tag', '-a', 'release', '-m', 'release').status).toBe(0);
    const tag = git(repo, 'rev-parse', 'refs/tags/release').stdout.trim();
    const zeros = '0'.repeat(40);

    const result = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `refs/tags/release ${tag} refs/tags/release ${zeros}\n`,
    });

    expect(result.status, combined(result)).toBe(1);
    expect(result.stdout).toContain('apps/hoa/tagged-secret.ts');
  });

  test.skipIf(!commandExists('gitleaks'))('scoped guard maps HEAD to an imported ref and scans deleted HOA secret history', () => {
    const repo = newRepo();
    write(repo, 'apps/hoa/safe.txt', 'base\n');
    const base = commit(repo, 'base');
    write(repo, 'apps/hoa/secret.ts', `export const token = '${STRIPE_SECRET}';\n`);
    commit(repo, 'HOA secret');
    rmSync(join(repo, 'apps/hoa/secret.ts'));
    const head = commit(repo, 'delete HOA secret');

    const result = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `HEAD ${head} refs/heads/feature ${base}\n`,
    });

    expect(result.status, combined(result)).toBe(1);
    expect(result.stdout).toContain('apps/hoa/secret.ts');
  });

  test.skipIf(!commandExists('gitleaks'))('scoped guard fails closed when local ref no longer matches buffered SHA', () => {
    const repo = newRepo();
    write(repo, 'apps/hoa/safe.txt', 'base\n');
    const base = commit(repo, 'base');
    write(repo, 'apps/hoa/safe.txt', 'changed\n');
    commit(repo, 'changed');

    const result = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `HEAD ${base} refs/heads/feature ${base}\n`,
    });

    expect(result.status, combined(result)).toBe(1);
    expect(result.stdout).toContain('secrets\n  (error:');
  });

  test.skipIf(!commandExists('gitleaks'))('scoped guard fails closed for raw and expression local refs', () => {
    const repo = newRepo();
    write(repo, 'apps/hoa/safe.txt', 'base\n');
    commit(repo, 'base');
    write(repo, 'apps/hoa/safe.txt', 'changed\n');
    const head = commit(repo, 'changed');

    for (const localRef of [head, 'HEAD~0']) {
      const result = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
        input: `${localRef} ${head} refs/heads/feature ${'0'.repeat(40)}\n`,
      });

      expect(result.status, combined(result)).toBe(1);
      expect(result.stdout).toContain('secrets\n  (error:');
    }
  });

  test('scoped guard ignores non-HOA large-file history and blocks deleted HOA large-file history', () => {
    const repo = newRepo();
    write(repo, 'apps/hoa/safe.txt', 'base\n');
    const base = commit(repo, 'base');
    write(repo, 'apps/hoa/safe.txt', 'changed\n');
    write(repo, 'apps/other/large.bin', Buffer.alloc(6 * 1024 * 1024));
    commit(repo, 'outside large file');
    rmSync(join(repo, 'apps/other/large.bin'));
    const outsideHead = commit(repo, 'delete outside large file');

    const outside = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `refs/heads/main ${outsideHead} refs/heads/main ${base}\n`,
    });

    expect(outside.status, combined(outside)).toBe(0);
    expect(outside.stdout).toContain('guard pre-push');

    write(repo, 'apps/hoa/large.bin', Buffer.alloc(6 * 1024 * 1024));
    commit(repo, 'HOA large file');
    rmSync(join(repo, 'apps/hoa/large.bin'));
    const hoaHead = commit(repo, 'delete HOA large file');

    const hoa = gg(repo, ['guard', 'pre-push', '--', 'apps/hoa'], {
      input: `refs/heads/main ${hoaHead} refs/heads/main ${outsideHead}\n`,
    });

    expect(hoa.status, combined(hoa)).toBe(1);
    expect(hoa.stdout).toContain('apps/hoa/large.bin');
  });

describe('Python check regressions', () => {
  test.skipIf(!commandExists('uvx'))('python-bugs reports F821 but accepts Sphinx injected tags', () => {
    const repo = newRepo();
    write(repo, 'broken.py', 'print(undefined_name)\n');
    write(repo, 'conf.py', "if tags.has('docs'):\n    project = 'docs'\n");

    const broken = directCheck(repo, 'python-bugs', 'broken.py');
    const sphinx = directCheck(repo, 'python-bugs', 'conf.py');

    expect(broken.status, combined(broken)).toBe(0);
    expect(broken.stdout).toContain('F821');
    expect(broken.stdout).toContain('broken.py');
    expect(sphinx.status, combined(sphinx)).toBe(0);
    expect(sphinx.stdout).toBe('');
  });

  test.skipIf(!commandExists('uvx'))('dead-code handles two changed Python paths and reports a real unused function', () => {
    const repo = newRepo();
    write(repo, 'unused.py', 'def genuinely_unused():\n    return 1\n');
    write(repo, 'used.py', 'def used():\n    return 2\n\nprint(used())\n');
    git(repo, 'add', '-A');

    const result = directCheck(repo, 'dead-code', 'unused.py\nused.py');

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('unused.py');
    expect(result.stdout).toContain('genuinely_unused');
    expect(result.stderr).not.toContain('newline in string');
  });

  test.skipIf(!commandExists('uvx'))('complexity ignores new functions but reports increased existing complexity', () => {
    const repo = newRepo();
    write(repo, 'existing.py', 'def classify(x):\n    return x\n');
    const base = commit(repo, 'base');
    write(repo, 'new_complex.py', 'def fresh(a, b, c):\n    if a:\n        if b:\n            if c:\n                return 1\n    return 0\n');
    write(repo, 'existing.py', `def classify(x):\n${Array.from({ length: 12 }, (_, i) => `    ${i === 0 ? 'if' : 'elif'} x == ${i}:\n        return ${i}\n`).join('')}    return -1\n`);

    const result = directCheck(repo, 'complexity', 'new_complex.py\nexisting.py', { GG_BASE: base, GG_MODE: 'branch' });

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('existing.py');
    expect(result.stdout).toContain('classify');
    expect(result.stdout).not.toContain('new_complex.py');
    expect(result.stdout).not.toContain('fresh');
  });

  test.skipIf(!commandExists('uvx'))('architecture skips without contracts and creates no configuration', () => {
    const repo = newRepo();
    write(repo, 'app.py', 'value = 1\n');
    const before = snapshot(repo);

    const result = directCheck(repo, 'architecture', 'app.py');

    expect(result.status, combined(result)).toBe(2);
    expect(result.stdout).toContain('contract');
    expect(snapshot(repo)).toEqual(before);
    expect(existsSync(join(repo, '.importlinter'))).toBe(false);
  });
});

describe('metadata visible through supported behavior', () => {
  test('all shipped checks are dispatchable and gg reports a version', () => {
    const missing = readdirSync(CHECKS)
      .filter((name) => name.endsWith('.sh'))
      .filter((name) => !/^# gg-globs:/m.test(readFileSync(join(CHECKS, name), 'utf8')));
    const version = gg(ROOT, ['--version']);

    expect(missing).toEqual([]);
    expect(version.status, combined(version)).toBe(0);
    expect(version.stdout).toMatch(/^gg \d+\.\d+\.\d+\n$/);
  });
});

describe('interpreter portability', () => {
  // Regression: CI caught what local testing could not. Every script parsed
  // under Homebrew bash 5 while `mapfile` and an empty `case` arm made three
  // checks unparseable under the bash 3.2 that macOS ships and always will.
  // A stock Mac is the oldest interpreter a user can land on, so it is the one
  // the suite must assert against.
  const SYSTEM_BASH = '/bin/bash';

  test.skipIf(!existsSync(SYSTEM_BASH))('every shipped script parses under the system bash', () => {
    const scripts = [
      join(ROOT, 'gg'),
      join(ROOT, 'install.sh'),
      ...readdirSync(CHECKS).filter((f) => f.endsWith('.sh')).map((f) => join(CHECKS, f)),
    ];

    for (const script of scripts) {
      const result = run(SYSTEM_BASH, ['-n', script]);
      expect(result.status, `${script}: ${combined(result)}`).toBe(0);
    }
  });

  // Parsing is not enough. `mapfile` is a bash 4 BUILTIN, so a script using it
  // parses cleanly under 3.2 and fails only when the line executes. This test
  // therefore drives real findings out of the Python checks under /bin/bash;
  // asserting on the finding text is what forces the mapfile lines to run.
  test.skipIf(!existsSync(SYSTEM_BASH) || !commandExists('uvx'))('Python checks produce findings under the system bash', () => {
    const repo = newRepo();
    write(repo, 'app.py', 'def handler(event):\n    return event\n');
    write(repo, 'util.py', 'def helper(x):\n    return x\n');
    commit(repo, 'base');
    write(repo, 'app.py', 'def handler(event):\n    return undefined_thing(event)\n');
    write(repo, 'util.py', 'def helper(x):\n    return x\n\ndef genuinely_unused(y):\n    return y\n');
    commit(repo, 'work');

    const result = run(SYSTEM_BASH, [GG], { cwd: repo, env: testEnv() });

    expect(result.status, combined(result)).toBe(0);
    // python-bugs and dead-code both read GG_FILES through what used to be
    // mapfile; a bash-4-only builtin here surfaces as a check error, not a find.
    expect(result.stdout, combined(result)).toContain('F821');
    expect(result.stdout, combined(result)).toContain('genuinely_unused');
    expect(combined(result)).not.toContain('mapfile');
  });
});

describe('anti-slop check', () => {
  const hasNpm = commandExists('npx') && commandExists('npm');

  test.skipIf(!hasNpm)('reports vendored anti-slop violations scoped to the changed file, exiting zero', () => {
    const repo = newRepo();
    write(repo, 'clean.ts', 'export function ok(name: string): string {\n  return name;\n}\n');
    commit(repo, 'base');
    write(repo, 'slop.ts', 'export function save(value: object) {}\nexport function handle(input: unknown) {\n  return input;\n}\n');
    commit(repo, 'work');

    const result = directCheck(repo, 'anti-slop', 'slop.ts\nclean.ts');

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('slop.ts:1: ');
    expect(result.stdout).toContain('[anti-slop/no-object-parameters]');
    expect(result.stdout).toContain('[anti-slop/no-unknown-parameters]');
    // The finding is scoped to the file that carries it; the clean file is silent.
    expect(result.stdout).not.toContain('clean.ts');
  });

  test.skipIf(!hasNpm)('ignores the repository Oxlint config, preserving a repo-independent verdict', () => {
    const repo = newRepo();
    // A repository config that tries to silence an anti-slop rule and add its own
    // must change nothing: gg lints with its own config and --disable-nested-config.
    write(repo, '.oxlintrc.json', JSON.stringify({
      rules: { 'anti-slop/no-object-parameters': 'off', 'no-console': 'error' },
    }));
    write(repo, 'slop.ts', 'export function save(value: object) {}\nconsole.log("noise");\n');
    commit(repo, 'base');

    const result = directCheck(repo, 'anti-slop', 'slop.ts');

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout).toContain('[anti-slop/no-object-parameters]');
    expect(result.stdout).not.toContain('no-console');
  });

  test.skipIf(!hasNpm)('is silent and exits zero when the changed files carry no slop', () => {
    const repo = newRepo();
    write(repo, 'good.ts', 'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n');
    commit(repo, 'base');

    const result = directCheck(repo, 'anti-slop', 'good.ts');

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});
