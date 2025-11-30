import os
import io
import json
import ast
import operator
from pathlib import Path
from typing import Any, Dict, Tuple

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import (
    HTMLResponse,
    StreamingResponse,
    JSONResponse,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
import uvicorn

# ---------------------------------------------------------
# ENV & CLIENT SETUP
# ---------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
  raise RuntimeError("OPENAI_API_KEY is not set in environment or .env")

client = OpenAI(api_key=OPENAI_API_KEY)

MODEL_NAME = os.getenv("OPENAI_MODEL", "gpt-4o")
TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
VOICE_NAME = os.getenv("OPENAI_TTS_VOICE", "nova")
TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "whisper-1")

PROMPT_PATH = BASE_DIR / "prompt.txt"
KNOWLEDGE_PATH = BASE_DIR / "knowledge.json"

# ---------------------------------------------------------
# LOAD PROMPT + KNOWLEDGE
# ---------------------------------------------------------
if PROMPT_PATH.exists():
  base_prompt_text = PROMPT_PATH.read_text(encoding="utf-8")
else:
  base_prompt_text = (
      "You are Number Bot, a friendly math and counting buddy for a 5-year-old.\n"
      "You respond ONLY with JSON containing keys: text, screen, visual_aid, _math_logic.\n"
  )

MATH_OVERRIDES = """
IMPORTANT MATH DELEGATION RULES (OVERRIDE ANY EARLIER INSTRUCTIONS):

1) You NEVER compute answers or step-by-step math yourself. You only PARSE.
2) Always return a JSON object with:
   - text: what you say on screen (kid-friendly, short),
   - screen: a short summary for display (may be empty, backend will override for math),
   - visual_aid: optional emojis or simple visuals (or null),
   - _math_logic: an object with:
       intent: one of "COUNT", "CALCULATE", or "SMALL_TALK",
       target_number: number or null,
       is_impossible: boolean,
       step_size: number or null,
       unit: string or null,
       sequence: array of numbers (backend will override for math),
       time_estimate_seconds: number or null,
       time_estimate_text: string or null,
       visual_aid: string or null,
       expression: string or null (used for CALCULATE),
       spoken_problem: string or null (human-readable problem).

3) For intent = "CALCULATE":
   - Identify a single arithmetic problem in the child's utterance.
   - Put a machine-friendly Python-style expression in _math_logic.expression.
     Examples:
       "900 plus 500 divided by 2" -> "900 + 500 / 2"
       "12 times 3 minus 4" -> "12 * 3 - 4"
   - Use only numbers, +, -, *, /, parentheses, and spaces. NO words.
   - Set _math_logic.spoken_problem to a nice human phrase like
     "nine hundred plus five hundred divided by two".
   - DO NOT compute or state the final numeric answer in text or screen.
   - text should just say what problem we're solving, e.g.
     "Let's figure out nine hundred plus five hundred divided by two."
   - screen can be a short repetition of the problem or just "".
   - Backend will compute the numeric result and overwrite screen and text.

4) For intent = "COUNT":
   - Identify what the child wants to count to.
   - Set _math_logic.target_number to that integer (if any).
   - If they say something like "one sextillion", use the correct integer value if you can;
     otherwise, leave target_number null and explain in text that it's too big to count,
     and set is_impossible = true.
   - DO NOT fill step_size, sequence, or time_estimate_* yourself.
   - You may comment on whether it's a big number in text,
     but do NOT say how long counting would take.
   - Backend will compute jumps, sequence, step_size, and time estimates.

5) For intent = "SMALL_TALK":
   - When it's not really a math/counting request, set intent = "SMALL_TALK"
     and leave numeric fields null or empty.
   - Just respond in a kind, encouraging way.

6) Always return VALID JSON. No markdown. No extra commentary.
"""

BASE_PROMPT = base_prompt_text + "\n" + MATH_OVERRIDES

REFERENCE_DATA: Dict[str, Any] = {}
if KNOWLEDGE_PATH.exists():
  try:
    knowledge = json.loads(KNOWLEDGE_PATH.read_text(encoding="utf-8"))
    REFERENCE_DATA = knowledge.get("reference_data", {})
  except Exception:
    REFERENCE_DATA = {}

# ---------------------------------------------------------
# FASTAPI APP + STATIC
# ---------------------------------------------------------
app = FastAPI()

# Static files (CSS, JS)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

# CORS (if you ever host UI elsewhere you can restrict origins)
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_methods=["*"],
  allow_headers=["*"],
  allow_credentials=True,
)

# ---------------------------------------------------------
# SAFE EVAL FOR MATH
# ---------------------------------------------------------
ALLOWED_BINOPS = {
  ast.Add: operator.add,
  ast.Sub: operator.sub,
  ast.Mult: operator.mul,
  ast.Div: operator.truediv,
  ast.FloorDiv: operator.floordiv,
  ast.Mod: operator.mod,
  ast.Pow: operator.pow,
}

ALLOWED_UNARY = {
  ast.UAdd: operator.pos,
  ast.USub: operator.neg,
}


def safe_eval_expression(expr: str) -> float:
  """
  Safely evaluate a simple arithmetic expression consisting of numbers,
  +, -, *, /, //, %, **, parentheses, and unary +/-.
  """
  node = ast.parse(expr, mode="eval")

  def _eval(n: ast.AST) -> float:
    if isinstance(n, ast.Expression):
      return _eval(n.body)
    if isinstance(n, ast.Constant):
      if isinstance(n.value, (int, float)):
        return n.value
      raise ValueError("Non-numeric constant")
    if isinstance(n, ast.BinOp):
      op_type = type(n.op)
      if op_type not in ALLOWED_BINOPS:
        raise ValueError(f"Operator {op_type} not allowed")
      left = _eval(n.left)
      right = _eval(n.right)
      return ALLOWED_BINOPS[op_type](left, right)
    if isinstance(n, ast.UnaryOp):
      op_type = type(n.op)
      if op_type not in ALLOWED_UNARY:
        raise ValueError(f"Unary operator {op_type} not allowed")
      operand = _eval(n.operand)
      return ALLOWED_UNARY[op_type](operand)
    raise ValueError(f"Unsupported expression element: {type(n)}")

  return _eval(node)


# ---------------------------------------------------------
# COUNTING (JUMPS + TIME)
# ---------------------------------------------------------
def build_count_sequence(n: int) -> Tuple[int, list, bool]:
  """
  Return (step_size, sequence_list, is_impossible).
  sequence_list is what we show in 'Our 10 jumps' on screen.
  """
  if n <= 0:
    return 0, [], True

  if n <= 10:
    return 1, list(range(1, n + 1)), False

  step = max(n // 10, 1)
  seq = [step * i for i in range(1, 10)]
  if seq[-1] != n:
    seq.append(n)
  return step, seq, False


def estimate_count_time(num: int) -> Tuple[int, str]:
  """
  Rough estimate: count ~1 number per second.
  Returns (seconds, human_readable_text).
  """
  seconds = int(num)

  if seconds <= 120:
    return seconds, f"about {seconds} seconds"

  minutes = seconds / 60.0
  if minutes < 60:
    return seconds, f"about {round(minutes)} minutes"

  hours = minutes / 60.0
  if hours < 48:
    return seconds, f"about {round(hours)} hours"

  days = hours / 24.0
  if days < 365 * 2:
    return seconds, f"about {round(days)} days"

  years = days / 365.0
  if years < 1_000:
    return seconds, f"about {round(years)} years"
  if years < 1_000_000:
    return seconds, f"about {round(years / 1_000)} thousand years"
  if years < 1_000_000_000:
    return seconds, f"about {round(years / 1_000_000)} million years"

  return seconds, "longer than the age of the universe"


# ---------------------------------------------------------
# OPENAI HELPERS
# ---------------------------------------------------------
def transcribe_audio(audio_bytes: bytes) -> str:
  audio_file = io.BytesIO(audio_bytes)
  audio_file.name = "audio.webm"

  result = client.audio.transcriptions.create(
      model=TRANSCRIBE_MODEL,
      file=audio_file,
      response_format="text",
  )
  return result.strip()


def call_brain(user_text: str) -> Dict[str, Any]:
  messages = [
    {"role": "system", "content": BASE_PROMPT},
  ]

  if REFERENCE_DATA:
    messages.append(
        {
          "role": "system",
          "content": json.dumps(
              {"reference_data": REFERENCE_DATA},
              ensure_ascii=False,
          ),
        }
    )

  messages.append({"role": "user", "content": user_text})

  completion = client.chat.completions.create(
      model=MODEL_NAME,
      messages=messages,
      response_format={"type": "json_object"},
      temperature=0.2,
  )

  raw = completion.choices[0].message.content
  try:
    data = json.loads(raw)
  except Exception:
    data = {
      "text": raw,
      "screen": "",
      "visual_aid": None,
      "_math_logic": {
        "intent": "SMALL_TALK",
        "target_number": None,
        "is_impossible": False,
        "step_size": None,
        "unit": None,
        "sequence": [],
        "time_estimate_seconds": None,
        "time_estimate_text": None,
        "visual_aid": None,
      },
    }
  return data


def apply_math_logic(data: Dict[str, Any], transcript: str) -> Dict[str, Any]:
  logic = data.get("_math_logic") or {}
  intent = (logic.get("intent") or "").upper()

  logic.setdefault("target_number", None)
  logic.setdefault("is_impossible", False)
  logic.setdefault("step_size", None)
  logic.setdefault("unit", None)
  logic.setdefault("sequence", [])
  logic.setdefault("time_estimate_seconds", None)
  logic.setdefault("time_estimate_text", None)
  logic.setdefault("visual_aid", None)

  if intent == "CALCULATE":
    expr = (logic.get("expression") or "").strip()
    spoken_problem = (logic.get("spoken_problem") or transcript).strip()

    if not expr:
      logic["is_impossible"] = True
      logic["sequence"] = []
      data["screen"] = "I couldn't understand that math problem."
      data["text"] = (
          "I couldn't quite figure out that math problem, but we can try another one!"
      )
    else:
      try:
        result = safe_eval_expression(expr)
      except Exception:
        logic["is_impossible"] = True
        logic["sequence"] = []
        data["screen"] = "I couldn't understand that math problem."
        data["text"] = (
            "I couldn't quite figure out that math problem, but we can try another one!"
        )
      else:
        if isinstance(result, float) and result.is_integer():
          result = int(result)

        logic["target_number"] = result
        logic["is_impossible"] = False
        logic["sequence"] = [result]

        if isinstance(result, int):
          screen = f"{result:,}"
        else:
          screen = f"{result:.4f}".rstrip("0").rstrip(".")

        data["screen"] = screen
        data["text"] = f"You asked what {spoken_problem} is. The answer is {screen}."

    data["_math_logic"] = logic
    return data

  if intent == "COUNT":
      target = logic.get("target_number")
      try:
          n = int(target)
      except Exception:
          # If LLM couldn't supply a numeric target, treat as impossible
          logic["is_impossible"] = True
          logic["sequence"] = []
          data["screen"] = ""
          data["_math_logic"] = logic
          return data

      if n <= 0:
          logic["is_impossible"] = True
          logic["sequence"] = []
          data["screen"] = ""
          data["_math_logic"] = logic
          return data

      step_size, seq, is_impossible = build_count_sequence(n)
      logic["step_size"] = step_size
      logic["sequence"] = seq
      logic["is_impossible"] = is_impossible
      logic["target_number"] = n

      # Time estimate for counting by ones
      seconds, time_text = estimate_count_time(n)
      logic["time_estimate_seconds"] = seconds
      logic["time_estimate_text"] = time_text

      # Build screen string: for small n, just show 1..n; for big, the jumps
      if n <= 10:
          screen = ", ".join(str(x) for x in seq)
          digits_for_voice = [str(x) for x in seq]
      else:
          screen = ", ".join(f"{x:,}" for x in seq)
          digits_for_voice = [f"{x:,}" for x in seq]

      data["screen"] = screen

      # Build spoken text that matches the same jumps.
      unit = logic.get("unit")
      target_digits = f"{n:,}"

      if unit:
          # crude pluralization: "popsicle" -> "popsicles" when number != 1
          plural_unit = unit if n == 1 else unit + "s"
          intro = f"Let's jump up to {target_digits} {plural_unit}."
      else:
          intro = f"Let's jump up to {target_digits}."

      jumps_phrase = ", ".join(digits_for_voice)
      # e.g. "Our ten jumps are: 100,000, 200,000, ...".
      jumps_line = f" Our ten jumps are: {jumps_phrase}."
      time_line = f" If you counted by ones, it would take {time_text}."

      data["text"] = intro + jumps_line + time_line
      data["_math_logic"] = logic
      return data


# ---------------------------------------------------------
# ROUTES
# ---------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
  html_path = BASE_DIR / "index.html"
  if not html_path.exists():
    return HTMLResponse(
        "<h1>Number Bot UI not found (index.html missing)</h1>",
        status_code=500,
    )
  return HTMLResponse(html_path.read_text(encoding="utf-8"))


@app.post("/chat")
async def chat(request: Request, file: UploadFile = File(None)) -> JSONResponse:
  """
  Main brain endpoint:
    1) Transcribe audio,
    2) Ask LLM for JSON,
    3) Do real math in Python,
    4) Return JSON.
  """
  content_type = request.headers.get("content-type", "")

  user_text = ""

  if "multipart/form-data" in content_type:
    if file is None:
      return JSONResponse(
          {"error": "No audio file provided", "user_text": ""},
          status_code=400,
      )
    audio_bytes = await file.read()
    if not audio_bytes:
      return JSONResponse(
          {"error": "Empty audio file", "user_text": ""},
          status_code=400,
      )
    user_text = transcribe_audio(audio_bytes)
  else:
    try:
      body = await request.json()
      user_text = (body.get("text") or "").strip()
    except Exception:
      user_text = ""

  if not user_text:
    return JSONResponse(
        {"error": "No text captured from audio", "user_text": ""},
        status_code=400,
    )

  data = call_brain(user_text)
  data = apply_math_logic(data, user_text)
  data["user_text"] = user_text

  return JSONResponse(data)


@app.get("/speak")
async def speak(text: str) -> StreamingResponse:
  text = (text or "").strip()
  if not text:
    return StreamingResponse(
        iter(()),
        media_type="audio/mpeg",
        status_code=400,
    )

  def audio_stream():
    with client.audio.speech.with_streaming_response.create(
        model=TTS_MODEL,
        voice=VOICE_NAME,
        input=text,
    ) as resp:
      for chunk in resp.iter_bytes():
        yield chunk

  return StreamingResponse(audio_stream(), media_type="audio/mpeg")


@app.get("/health")
async def health() -> Dict[str, str]:
  return {"status": "ok"}


if __name__ == "__main__":
  port = int(os.getenv("PORT", "8000"))
  uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
