export function setupRecorder(options) {
  const {
    recordBtn,
    stopBtn,
    statusEl,
    silenceBar,
    devStatsEl,
    addMessage,
    appendDebugLog,
    updateSizeMeter,
  } = options;

  let mediaRecorder;
  let audioChunks = [];
  let isRecording = false;
  let isBusy = false;       // brain/voice pipeline in progress
  let isSpeaking = false;   // TTS currently playing
  let skipNextProcess = false; // used when user cancels

  let currentAudio = null;
  let abortController = null;

  let audioContext, analyser, microphone;
  let silenceStart = Date.now();
  const SILENCE_THRESHOLD = 0.02;
  const SILENCE_DURATION = 2000;
  const MAX_RECORD_TIME = 10000;
  let maxTimer = null;

  let t_start, t_brain, t_voice;

  async function startRecording() {
    // Do not start if we're already recording OR still handling prior brain/voice
    if (isRecording || isBusy || isSpeaking) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);
      analyser.fftSize = 2048;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        // If user pressed "stop" as cancel, skipNextProcess=true
        if (audioChunks.length > 0 && !skipNextProcess) {
          processAudio();
        }
        skipNextProcess = false;
        if (audioContext) audioContext.close();
      };

      mediaRecorder.start();
      isRecording = true;
      silenceStart = Date.now();

      recordBtn.classList.add("recording");
      stopBtn.classList.add("active");
      statusEl.innerText = "Listening...";

      monitorSilence(dataArray, bufferLength);

      maxTimer = setTimeout(() => {
        if (isRecording) stopRecording("Auto-Stop Max Time");
      }, MAX_RECORD_TIME);
    } catch (err) {
      console.error(err);
      statusEl.innerText = "Mic error";
      setTimeout(() => resetUI("Ready"), 2000);
    }
  }

  function monitorSilence(dataArray, bufferLength) {
    if (!analyser || !isRecording) return;
    analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = (dataArray[i] - 128) / 128.0;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / bufferLength);
    const volume = Math.min(rms * 10, 1);
    silenceBar.style.width = volume * 100 + "%";

    if (rms < SILENCE_THRESHOLD) {
      const now = Date.now();
      const silenceTime = now - silenceStart;
      if (silenceTime > SILENCE_DURATION) {
        stopRecording("Auto-Stop");
        return;
      }
    } else {
      silenceStart = Date.now();
      silenceBar.style.width = "0%";
    }
    requestAnimationFrame(() => monitorSilence(dataArray, bufferLength));
  }

  function stopRecording(reason) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      if (reason === "Cancelled") {
        // Mark that we don't want to process this audio
        skipNextProcess = true;
      } else {
        // We're going to process this audio → mark busy
        isBusy = true;
      }
      mediaRecorder.stop();
    }
    isRecording = false;
    clearTimeout(maxTimer);

    if (reason === "Cancelled") {
      statusEl.innerText = "Cancelled";
      // Immediately reset so he can try again
      resetUI("Ready");
    } else {
      recordBtn.classList.remove("recording");
      recordBtn.classList.add("thinking");
      statusEl.innerText = "Thinking...";
      silenceBar.style.width = "0%";
    }
  }

  async function processAudio() {
    t_start = Date.now();
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("file", audioBlob, "voice.webm");
    abortController = new AbortController();

    try {
      const chatResponse = await fetch("/chat", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });
      const data = await chatResponse.json();
      appendDebugLog(
        "Response: " + JSON.stringify(data._math_logic || {}, null, 0)
      );

      if (
        data._math_logic &&
        typeof data._math_logic.target_number !== "undefined"
      ) {
        updateSizeMeter(data._math_logic.target_number);
      } else {
        updateSizeMeter(null);
      }

      t_brain = Date.now();

      if (data.user_text) addMessage(data.user_text, "user-msg");

      if (data.text) {
        const brainTime = t_brain - t_start;
        devStatsEl.innerText = `Brain: ${brainTime}ms | Voice: ...`;

        const audioRes = await fetch(
          `/speak?text=${encodeURIComponent(data.text)}`
        );
        const ttsBlob = await audioRes.blob();
        const audioUrl = URL.createObjectURL(ttsBlob);

        t_voice = Date.now();

        recordBtn.classList.remove("thinking");
        recordBtn.classList.add("speaking");
        statusEl.innerText = "Speaking...";
        isSpeaking = true;

        let visualContent;
        if (
          data._math_logic &&
          data._math_logic.intent === "COUNT" &&
          data.screen
        ) {
          const parts = data.screen.split(", ");
          visualContent =
            '<div class="steps-label">Our 10 jumps:</div><ul class="steps-list">' +
            parts.map((p) => `<li>${p}</li>`).join("") +
            "</ul>";
        } else {
          visualContent = data.screen
            ? `<strong>${data.screen}</strong>`
            : data.text;
        }
        addMessage(visualContent, "bot-msg", data.visual_aid);

        const voiceTime = t_voice - t_brain;
        const totalTime = t_voice - t_start;
        devStatsEl.innerText = `Brain: ${brainTime}ms | Voice: ${voiceTime}ms | Total: ${totalTime}ms`;

        // Stop any previous audio just in case
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
        }

        currentAudio = new Audio(audioUrl);
        currentAudio.play();
        currentAudio.onended = () => {
          isSpeaking = false;
          resetUI("Ready");
        };
      } else {
        // No data.text, just reset
        resetUI("Ready");
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error(error);
        statusEl.innerText = "Error";
        setTimeout(() => resetUI("Ready"), 2000);
      }
    }
  }

  function resetUI(text) {
    recordBtn.className = "";
    stopBtn.classList.remove("active");
    statusEl.innerText = text || "Ready";
    isRecording = false;
    isBusy = false;
    isSpeaking = false;
    silenceBar.style.width = "0%";
    abortController = null;
  }

  // Button wiring
  recordBtn.addEventListener("click", () => {
    // If we're speaking or busy, ignore taps
    if (isSpeaking || isBusy) return;

    if (isRecording) {
      stopRecording("Manual");
    } else {
      startRecording();
    }
  });

  stopBtn.addEventListener("click", () => {
    if (isRecording) {
      // Cancel current recording (do not send to /chat)
      stopRecording("Cancelled");
    } else if (currentAudio) {
      // Stop current TTS early
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
      resetUI("Ready");
    }
  });
}
