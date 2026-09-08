import { afterEach, expect, test } from 'bun:test';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gg-setup-test-')));
  temporary.push(root);
  const install = join(root, 'install');
  const bin = join(root, 'bin');
  const tools = join(root, 'prepared tools');
  mkdirSync(join(install, 'checks'), { recursive: true });
  mkdirSync(bin);
  for (const path of ['gg', 'setup.sh', 'checks/runners', 'checks/python-bugs.sh']) cpSync(join(source, path), join(install, path));
  const plugin = join(install, 'checks/anti-slop/plugin');
  mkdirSync(plugin, { recursive: true });
  cpSync(join(source, 'checks/anti-slop/plugin/package.json'), join(plugin, 'package.json'));
  const manager = `#!/bin/bash
set -eu
printf '%s' "$(basename "$0")" >> "$GG_SETUP_LOG"
printf '\\t%s' "$@" >> "$GG_SETUP_LOG"
printf '\\n' >> "$GG_SETUP_LOG"
case "$(basename "$0"):$1" in
  uv:venv)
    mkdir -p "$2/bin"
    printf '#!/bin/sh\\nexit 0\\n' > "$2/bin/python"
    chmod +x "$2/bin/python"
    ;;
  uv:pip)
    destination=$(dirname "$4")
    for tool in ruff vulture radon lint-imports; do
      printf '#!/bin/sh\\nprintf "sample.py:1:1: F821 Undefined name missing\\\\n"\\nexit 1\\n' > "$destination/$tool"
      chmod +x "$destination/$tool"
    done
    ;;
  bun:add)
    mkdir -p "$3/node_modules/.bin"
    for tool in fallow oxlint; do
      printf '#!/bin/sh\\necho prepared\\n' > "$3/node_modules/.bin/$tool"
      chmod +x "$3/node_modules/.bin/$tool"
    done
    ;;
  bun:install)
    mkdir -p "$3/node_modules/@oxlint/plugins"
    printf '{}\\n' > "$3/node_modules/@oxlint/plugins/package.json"
    ;;
  *) exit 99 ;;
esac
`;
  for (const command of ['uv', 'bun']) {
    writeFileSync(join(bin, command), manager);
    chmodSync(join(bin, command), 0o755);
  }
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, GG_TOOLS_DIR: tools,
    GG_SETUP_LOG: join(root, 'managers.log'), GG_NO_UPDATE_CHECK: '1', CI: 'true',
    GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'gg test', GIT_AUTHOR_EMAIL: 'gg@example.test',
    GIT_COMMITTER_NAME: 'gg test', GIT_COMMITTER_EMAIL: 'gg@example.test',
  };
  function run(args: string[], cwd = root, extra = {}) {
    return spawnSync('/bin/bash', [join(install, 'gg'), ...args], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
  }
  return { root, bin, tools, install, plugin, env, run, log: () => readFileSync(env.GG_SETUP_LOG, 'utf8') };
}

test('gg setup prepares exact pinned runners and review never reruns package managers', () => {
  const f = fixture();
  const setup = f.run(['setup']);
  expect(setup.status, setup.stderr).toBe(0);
  expect(setup.stdout).toContain(`runners prepared in ${f.tools}`);
  const prepared = f.log();
  expect(prepared.trim().split('\n')).toEqual([
    `uv\tvenv\t${f.tools}/python`,
    `uv\tpip\tinstall\t--python\t${f.tools}/python/bin/python\truff==0.14.2\tvulture==2.14\tradon==6.0.1\timport-linter==2.3`,
    `bun\tadd\t--cwd\t${f.tools}/js\t--exact\t--trust\tfallow@2.79.0\toxlint@1.78.0`,
    `bun\tinstall\t--cwd\t${f.plugin}\t--no-save`,
  ]);
  const repo = join(f.root, 'repo');
  mkdirSync(repo);
  function git(...args: string[]) {
    const result = spawnSync('git', args, { cwd: repo, env: f.env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  }
  git('init', '-q');
  git('config', 'core.hooksPath', '/dev/null');
  writeFileSync(join(repo, 'sample.py'), 'missing()\n');
  git('add', 'sample.py');
  const review = f.run(['--json', 'sample.py'], repo);
  expect(review.status, review.stderr).toBe(0);
  expect(JSON.parse(review.stdout).checks[0].findings).toEqual(['sample.py:1: F821 Undefined name missing']);
  expect(f.log()).toBe(prepared);
});

test('setup preserves an existing plugin dependency symlink', () => {
  const f = fixture();
  const dependencies = join(f.root, 'existing dependencies');
  mkdirSync(join(dependencies, '@oxlint/plugins'), { recursive: true });
  writeFileSync(join(dependencies, '@oxlint/plugins/package.json'), '{"sentinel":true}\n');
  symlinkSync(dependencies, join(f.plugin, 'node_modules'));
  const result = f.run(['setup']);
  expect(result.status, result.stderr).toBe(0);
  expect(f.log()).not.toContain('bun\tinstall');
  expect(lstatSync(join(f.plugin, 'node_modules')).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(dependencies, '@oxlint/plugins/package.json'), 'utf8')).toBe('{"sentinel":true}\n');
});

test('setup reports a missing prerequisite before installation or tool-directory creation', () => {
  const f = fixture();
  const restricted = join(f.root, 'restricted');
  mkdirSync(restricted);
  for (const command of ['dirname', 'realpath']) {
    const located = spawnSync('/bin/sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).stdout.trim();
    symlinkSync(located, join(restricted, command));
  }
  const result = f.run(['setup'], f.root, { PATH: restricted });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('uv is required');
  expect(existsSync(f.tools)).toBe(false);
  expect(existsSync(f.env.GG_SETUP_LOG)).toBe(false);
});
