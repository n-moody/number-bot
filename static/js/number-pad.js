export function setupNumberPad(options) {
  const {
    numberBtn,
    numberPadOverlay,
    numberDisplay,
    padClose,
    statusEl,
  } = options;

  let currentNumberRaw = ""; // raw digits, no commas
  let isSpeaking = false;
  let currentAudio = null;
  let speakButton = null;

  function openNumberPad() {
    // optional: block opening while speaking
    if (isSpeaking) return;
    numberPadOverlay.style.display = "flex";
    updateDisplay();
  }

  function closeNumberPad() {
    // optional: block closing while speaking (so he doesn't hide it mid-speech)
    if (isSpeaking) return;
    numberPadOverlay.style.display = "none";
  }

  function formatWithCommas(raw) {
    if (!raw) return "";
    try {
      const asBig = BigInt(raw);
      return asBig.toLocaleString("en-US");
    } catch (e) {
      // Fallback: just raw
      return raw;
    }
  }

  function updateDisplay() {
    numberDisplay.textContent = formatWithCommas(currentNumberRaw);
  }

  function setSpeakingState(active) {
    isSpeaking = active;
    if (!speakButton) return;
    speakButton.disabled = active;
    speakButton.style.opacity = active ? "0.6" : "1";
  }

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.innerText = text;
  }

  numberBtn.addEventListener("click", openNumberPad);
  padClose.addEventListener("click", closeNumberPad);

  const padButtons = numberPadOverlay.querySelectorAll(".pad-btn");

  padButtons.forEach((btnEl) => {
    const digit = btnEl.getAttribute("data-digit");
    const action = btnEl.getAttribute("data-action");

    if (digit) {
      btnEl.addEventListener("click", () => {
        if (isSpeaking) return;
        if (currentNumberRaw.length >= 21) return; // cap length
        if (currentNumberRaw === "0") currentNumberRaw = digit;
        else currentNumberRaw += digit;
        updateDisplay();
      });
    } else if (action === "clear") {
      btnEl.addEventListener("click", () => {
        if (isSpeaking) return;
        currentNumberRaw = "";
        updateDisplay();
      });
    } else if (action === "speak") {
      speakButton = btnEl;

      btnEl.addEventListener("click", () => {
        if (isSpeaking) return;
        if (!currentNumberRaw) return;

        let num;
        try {
          num = BigInt(currentNumberRaw);
        } catch {
          return;
        }

        const words = numberToWordsBig(num);
        setStatus("Speaking number...");
        setSpeakingState(true);

        // stop any previous number audio just in case
        if (currentAudio) {
          try {
            currentAudio.pause();
          } catch (_) {
            /* ignore */
          }
        }

        fetch(`/speak?text=${encodeURIComponent(words)}`)
          .then((res) => res.blob())
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            currentAudio = audio;
            audio.play();
            audio.onended = () => {
              setSpeakingState(false);
              setStatus("Ready");
            };
          })
          .catch((err) => {
            console.error(err);
            setSpeakingState(false);
            setStatus("Error");
            setTimeout(() => setStatus("Ready"), 1000);
          });
      });
    }
  });

  // ---- BigInt → words (up to sextillion) ----
  const SMALLS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const TENS = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];
  const SCALES = [
    "",
    "thousand",
    "million",
    "billion",
    "trillion",
    "quadrillion",
    "quintillion",
    "sextillion",
  ];

  function chunkToWords(n) {
    let num = Number(n);
    let parts = [];
    if (num >= 100) {
      const hundreds = Math.floor(num / 100);
      parts.push(SMALLS[hundreds] + " hundred");
      num = num % 100;
    }
    if (num >= 20) {
      const tensPart = Math.floor(num / 10);
      parts.push(TENS[tensPart]);
      num = num % 10;
    }
    if (num > 0 && num < 20) {
      parts.push(SMALLS[num]);
    }
    return parts.join(" ");
  }

  function numberToWordsBig(bigIntVal) {
    if (bigIntVal === 0n) return "zero";
    if (bigIntVal < 0n) return "minus " + numberToWordsBig(-bigIntVal);

    let s = bigIntVal.toString();
    const chunks = [];
    while (s.length > 0) {
      const sliceStart = Math.max(0, s.length - 3);
      const slice = s.slice(sliceStart);
      chunks.unshift(parseInt(slice, 10));
      s = s.slice(0, sliceStart);
    }

    let words = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk === 0) continue;
      const chunkWords = chunkToWords(chunk);
      const scaleIndex = chunks.length - i - 1;
      const scale = SCALES[scaleIndex] || "";
      words.push(chunkWords + (scale ? " " + scale : ""));
    }
    return words.join(" ");
  }
}
