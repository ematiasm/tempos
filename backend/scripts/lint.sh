#!/usr/bin/env bash

set -e
set -x

# mypy and ty are scoped to ``app`` on purpose: ``tests`` currently has 438
# untyped-def findings, so widening the type gates is a piece of work of its own
# and not something to smuggle into a lint script.
#
# ruff covers ``tests`` as well. Leaving it out is how an unformatted test file
# survived in the tree: this script was the only local runner, and the
# pre-commit hooks only see files changed in a pull request.
mypy app
ty check app
ruff check app tests
ruff format app tests --check
