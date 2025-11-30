#!/usr/bin/env bash
set -euo pipefail

# Always run from the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Pick a Python executable
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "Python 3 not found. Please install Python 3 first."
  # If sourced, return; otherwise exit
  if [ "${BASH_SOURCE[0]}" != "$0" ]; then
    return 1
  else
    exit 1
  fi
fi

echo "Initializing Number Bot environment with: $PY"

# 1. Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
  echo "Creating virtual environment in ./venv ..."
  "$PY" -m venv venv
else
  echo "Virtual environment ./venv already exists."
fi

# 2. Activate virtual environment
# (this only persists if you run:  source init.sh)
# shellcheck disable=SC1091
source venv/bin/activate
echo "Virtual environment activated: $(which python)"

# 3. Ensure requirements.txt exists
if [ ! -f "requirements.txt" ]; then
  cat > requirements.txt << 'EOF'
fastapi
uvicorn
openai
python-dotenv
python-multipart
EOF
  echo "Created default requirements.txt."
fi

# 4. Install dependencies
echo "Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# 5. Ensure .env exists
if [ ! -f ".env" ]; then
  cat > .env << 'EOF'
OPENAI_API_KEY=sk-YOUR-KEY-HERE
OPENAI_TTS_VOICE=nova
EOF
  echo "Created .env (edit it and add your real API key)."
else
  echo ".env file found."
fi

echo "----------------------------------------"
echo "Setup complete. To run the app now:"
echo "  python app.py"
echo "----------------------------------------"

