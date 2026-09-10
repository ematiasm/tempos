#!/bin/sh -e
set -x

# Keep this list in sync with scripts/lint.sh so the fixer and the checker always
# agree on their scope.
ruff check app scripts tests --fix
ruff format app scripts tests
