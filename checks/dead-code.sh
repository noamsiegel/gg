#!/usr/bin/env bash
# gg-globs: *.py
#
# This check is structurally different from the other checks: it analyzes the
# whole repository, then reports only findings in GG_FILES. Vulture needs that
# whole-program view because a function defined in a changed file can be called
# from an unchanged file; analyzing only the diff would invent a dead-code
# finding. Git supplies the input set so tracked code is included while ignored
# files and common generated or vendored directories are excluded cheaply.

set -euo pipefail

source "$(dirname "$0")/runners"
gg_require_runner python vulture

cd "$GG_ROOT"
# Bash 3.2 has no `mapfile`, so keep the Git-produced path set in a temporary
# file. The prepared runner's Python process loads that list after startup,
# avoiding ARG_MAX while preserving one Vulture instance and one usage graph.
# The explicit empty case command also avoids a Bash 3.2 parser bug.
python_file_list=$(mktemp)
output=$(mktemp)
trap 'rm -f "$python_file_list" "$output"' EXIT
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  case "/$path/" in
    */.venv/*|*/node_modules/*|*/build/*|*/dist/*|*/.git/*) : ;;
    *) printf '%s\n' "$path" ;;
  esac
done < <(git ls-files --cached --others --exclude-standard -- '*.py') >"$python_file_list"

if [[ ! -s "$python_file_list" ]]; then
  printf '%s\n' 'no Python files outside excluded directories'
  exit 4
fi

status=0
runner_python="${runner%/*}/python"
"$runner_python" -c '
import ast
import sys
from pathlib import Path

from vulture import utils as vulture_utils
from vulture.config import InputError, make_config
from vulture.core import Vulture
from vulture.utils import ExitCode

def is_python_source(path):
    # A cookiecutter.json owns brace-path files as render inputs.
    source_path = Path(path)
    return not (
        ("{{" in path or "}}" in path)
        and any((parent / "cookiecutter.json").is_file() for parent in source_path.parents)
    )

with open(sys.argv[1], encoding="utf-8") as file_list:
    paths = [
        path
        for line in file_list
        if (path := line.rstrip("\n")) and is_python_source(path)
    ]
if not paths:
    raise SystemExit(4)
try:
    config = make_config(paths)
except InputError as error:
    print(error, file=sys.stderr)
    raise SystemExit(ExitCode.InvalidCmdlineArguments)
vulture = Vulture(
    verbose=config["verbose"],
    ignore_names=config["ignore_names"],
    ignore_decorators=config["ignore_decorators"],
)
# Vulture requests type-comment parsing. Valid Python can contain a regular
# comment shaped like an invalid type comment; retry only that parser failure
# without type comments so the module remains in the whole-program graph.
original_parse = ast.parse
def parse_compatible_type_comments(*args, **kwargs):
    try:
        return original_parse(*args, **kwargs)
    except SyntaxError as type_comment_error:
        if not kwargs.get("type_comments"):
            raise
        kwargs["type_comments"] = False
        try:
            return original_parse(*args, **kwargs)
        except SyntaxError:
            raise type_comment_error

original_read_file = vulture_utils.read_file
def read_python_or_hex_cell(path):
    source = original_read_file(path)
    lines = source.splitlines(keepends=True)
    if "Python cell template" not in "".join(lines[:30]):
        return source
    transformed = []
    for line in lines:
        body = line.rstrip("\r\n")
        ending = line[len(body):]
        if body.lstrip().startswith(("!", "%")):
            indentation = body[: len(body) - len(body.lstrip())]
            transformed.append(f"{indentation}# gg: Hex cell magic omitted{ending}")
        else:
            transformed.append(line)
    return "".join(transformed)

ast.parse = parse_compatible_type_comments
vulture_utils.read_file = read_python_or_hex_cell
try:
    vulture.scavenge(config["paths"], exclude=config["exclude"])
finally:
    ast.parse = original_parse
    vulture_utils.read_file = original_read_file
scan_status = vulture.exit_code
report_status = vulture.report(
    min_confidence=config["min_confidence"],
    sort_by_size=config["sort_by_size"],
    make_whitelist=config["make_whitelist"],
)
# Vulture 2.14 overwrites InvalidInput with DeadCode when both occur.
raise SystemExit(
    ExitCode.InvalidInput if scan_status == ExitCode.InvalidInput else report_status
)
' "$python_file_list" >"$output" || status=$?
# Vulture exits 3 when it found dead code. That is a successful check run.
# The adapter uses 4 when every discovered Python path is a declared template.
if (( status == 4 )); then
  printf '%s\n' 'no analyzable Python sources outside declared templates'
  exit 4
fi
# Vulture exits 1 on invalid input. Exit 2 is reserved for "runner unavailable"
# in the gg protocol, so remap execution failures after filtering any findings.
check_status=0
if (( status != 0 && status != 3 )); then
  check_status=3
fi

# GG_FILES is newline-separated, so it must reach awk through ENVIRON rather than
# -v: awk's -v processes escape sequences and cannot carry a literal newline.
awk '
  BEGIN {
    count = split(ENVIRON["GG_FILES"], paths, "\n")
    for (i = 1; i <= count; i++) wanted[paths[i]] = 1
  }
  {
    path = $0
    sub(/:[0-9]+:.*/, "", path)
    sub(/^\.\//, "", path)
    if (wanted[path]) print
  }
' "$output"

exit "$check_status"
