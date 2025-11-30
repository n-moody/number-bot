import { setupRecorder } from "./recorder.js";
import { setupNumberPad } from "./number-pad.js";

// DOM references
const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const chatContainer = document.getElementById("chatContainer");
const silenceBar = document.getElementById("silenceBar");
const devStatsEl = document.getElementById("devStats");
const dadToggle = document.getElementById("dadToggle");
const debugPanel = document.getElementById("debugPanel");
const sizeMeter = document.getElementById("sizeMeter");
const sizeMarker = document.getElementById("sizeMarker");
const quickChips = document.querySelectorAll(".quick-chip");

const numberBtn = document.getElementById("numberBtn");
const numberPadOverlay = document.getElementById("numberPadOverlay");
const numberDisplay = document.getElementById("numberDisplay");
const padClose = document.getElementById("padClose");

let dadMode = false;

// Dad mode toggle
dadToggle.addEventListener("click", () => {
  dadMode = !dadMode;
  dadToggle.classList.toggle("on", dadMode);
  dadToggle.textContent = dadMode ? "Dad mode: On" : "Dad mode: Off";
  const dadEls = document.querySelectorAll(".dad-only");
  dadEls.forEach((el) => {
    el.style.display = dadMode ? "block" : "none";
  });
  if (!dadMode && debugPanel) {
    debugPanel.textContent = "";
  }
});

// Quick chips just hint at phrases
quickChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const example = chip.getAttribute("data-example");
    statusEl.innerText = `Try saying: "${example}"`;
  });
});

function appendDebugLog(text) {
  if (!dadMode || !debugPanel) return;
  const timestamp = new Date().toLocaleTimeString();
  debugPanel.textContent += `\n[${timestamp}] ${text}`;
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

function updateSizeMeter(targetNumber) {
  if (!targetNumber || typeof targetNumber !== "number" || targetNumber <= 0) {
    sizeMeter.style.display = "none";
    return;
  }
  sizeMeter.style.display = "block";
  let pos = 0.1;
  if (targetNumber <= 10) pos = 0.15;
  else if (targetNumber <= 100) pos = 0.3;
  else if (targetNumber <= 10000) pos = 0.45;
  else if (targetNumber <= 1000000) pos = 0.6;
  else if (targetNumber <= 1000000000) pos = 0.8;
  else pos = 0.95;
  sizeMarker.style.left = pos * 100 + "%";
}

function addMessage(htmlContent, className, emojiContent = null) {
  const div = document.createElement("div");
  div.className = `message ${className}`;
  div.innerHTML = htmlContent;
  if (emojiContent) {
    const emojiDiv = document.createElement("div");
    emojiDiv.className = "emoji-row";
    emojiDiv.innerText = emojiContent;
    div.appendChild(emojiDiv);
  }
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Wire up recorder (speech → /chat → /speak)
setupRecorder({
  recordBtn,
  stopBtn,
  statusEl,
  silenceBar,
  devStatsEl,
  addMessage,
  appendDebugLog,
  updateSizeMeter,
});

// Wire up number pad (typed number → /speak)
setupNumberPad({
  numberBtn,
  numberPadOverlay,
  numberDisplay,
  padClose,
  statusEl,
});

// Warn before leaving the page
window.addEventListener("beforeunload", (event) => {
  event.preventDefault();
  event.returnValue = "Are you sure you want to leave Number Bot?";
});
