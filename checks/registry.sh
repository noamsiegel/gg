# Universal checks registry. Single source of truth for what git-guardrails
# enforces (and what it deliberately does NOT). Consumed by:
#   - cmd_doctor (tool reachability)
#   - lefthook.yml comments (cross-checked, not auto-generated)
#   - README generation (manual today; can be automated later)

# One entry per check: hook|command|skip_env|required_tools|rationale
GIT_GUARDRAILS_CHECKS=(
  "pre-push|branch-guard|SKIP_BRANCH_GUARD|git bash|Block pushes to protected refs (main, master, prod*)"
  "pre-commit|large-files|SKIP_LARGE_FILES|git bash|Refuse staging blobs over MAX_BLOB_SIZE"
  "pre-commit|gitleaks|SKIP_GITLEAKS|gitleaks|Detect secrets in staged changes"
  "pre-commit|actionlint|SKIP_ACTIONLINT|actionlint|Validate .github/workflows YAML"
  "pre-commit|python-bugs|SKIP_PYTHON_BUGS|uvx git|Config-free Python bug rules (F821/F822/F823/F811/E902) on staged blobs"
  "commit-msg|commitlint|SKIP_COMMITLINT|commitlint|Conventional Commits format"
  "pre-push|fallow|SKIP_FALLOW|fallow bun|Universal code-health gate for JS/TS"
)

# Tools that MUST be reachable for the registry to work.
GIT_GUARDRAILS_REQUIRED_TOOLS=(git bash)

# Tools that are OPTIONAL (skip the corresponding check if missing).
GIT_GUARDRAILS_OPTIONAL_TOOLS=(lefthook gitleaks actionlint commitlint fallow bun uvx)
