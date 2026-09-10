#! /usr/bin/env bash

set -e
set -x

cd backend
uv run python -c "import app.main; import json; print(json.dumps(app.main.app.openapi()))" > ../openapi.json
cd ..
mv openapi.json frontend/
bun run --filter frontend generate-client
# ``lint:fix`` on purpose: the freshly generated client needs formatting, and
# ``lint`` is check-only (it has to be able to fail a validation run).
bun run lint:fix
