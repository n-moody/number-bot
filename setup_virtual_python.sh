#!/usr/bin/env bash

# run from project root
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

python3 -m venv venv
# shellcheck disable=SC1091
source venv/bin/activate

echo "Virtual env ready. Run: python app.py"

