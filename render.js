const { ipcRenderer } = require("electron");

const hitSound = new Audio("slap.wav");
hitSound.preload = "auto";
hitSound.volume = 1;

// ─── State ────────────────────────────────────────────────────────────────────
let audioContext = null;
let analyser     = null;
let stream       = null;
let animFrame    = null;

let smoothedVolume = 0;
let noiseFloor     = 2000;
let peakVolume      = 0;
let lastTrigger    = 0;
let startTime      = null;
let hits           = 0;
let listening      = false;
let sensitivity    = 4;

const COOLDOWN         = 1200;
const CALIBRATION_TIME = 2000;
const SENS_MIN = 1;
const SENS_MAX = 10;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const pulseDot   = document.getElementById("pulse-dot");
const statusText = document.getElementById("status-text");
const hitsBadge  = document.getElementById("hits-badge");
const volFill    = document.getElementById("vol-fill");
const sensSlider = document.getElementById("sens-slider");
const sensVal    = document.getElementById("sens-val");
const triggerVal = document.getElementById("trigger-val");
const modeHint   = document.getElementById("mode-hint");
const toggleBtn  = document.getElementById("toggle-btn");
const closeBtn   = document.getElementById("close-btn");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  const ratio = (value - inMin) / (inMax - inMin);
  return outMin + ratio * (outMax - outMin);
}

function computeThreshold(currentNoiseFloor, currentSensitivity) {
  // Lower sensitivity value => easier trigger, higher value => stronger hit needed.
  const dynamicDelta = mapRange(currentSensitivity, SENS_MIN, SENS_MAX, 260, 5200);
  const absoluteGate = mapRange(currentSensitivity, SENS_MIN, SENS_MAX, 1400, 12000);
  return Math.max(currentNoiseFloor + dynamicDelta, absoluteGate);
}

function updateSensitivityUI() {
  sensVal.textContent = sensitivity.toFixed(1);
  modeHint.textContent = sensitivity <= 4
    ? "Low setting: softer sounds can trigger a hit"
    : "High setting: only louder impacts can trigger a hit";
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setListeningUI(active) {
  if (active) {
    pulseDot.classList.add("active");
    statusText.textContent = "Listening";
    toggleBtn.textContent  = "Stop Listening";
    toggleBtn.classList.add("is-listening");
  } else {
    pulseDot.classList.remove("active");
    statusText.textContent = "Idle";
    toggleBtn.textContent  = "Start Listening";
    toggleBtn.classList.remove("is-listening");
    volFill.style.width      = "0%";
    volFill.style.background = "var(--accent)";
  }
}

function updateVolBar(volume) {
  // Map 0–8000 to 0–100% (typical mic range)
  const pct = Math.min(100, (volume / 12000) * 100);
  volFill.style.width = pct.toFixed(1) + "%";

  if (pct > 80)      volFill.style.background = "#dc2626";
  else if (pct > 55) volFill.style.background = "#f97316";
  else               volFill.style.background = "#22c55e";
}

function bumpHits() {
  hits++;
  hitsBadge.textContent = hits + (hits === 1 ? " hit" : " hits");
  // Flash the bar red on impact
  volFill.style.width      = "95%";
  volFill.style.background = "#dc2626";
  setTimeout(() => { volFill.style.background = "#22c55e"; }, 250);
}

function playHitSoundNow() {
  // Rewind and play immediately in renderer to avoid process-spawn delay.
  hitSound.currentTime = 0;
  hitSound.play().catch(() => {
    // Fallback if renderer playback is blocked for any reason.
    ipcRenderer.send("impact-detected");
  });
}

// ─── Audio ────────────────────────────────────────────────────────────────────
async function startListening() {
  if (listening) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    console.error("Mic permission denied:", err);
    statusText.textContent = "No mic access";
    return;
  }

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.fftSize);

  smoothedVolume = 0;
  noiseFloor     = 2000;
  peakVolume     = 0;
  lastTrigger    = 0;
  startTime      = Date.now();
  listening      = true;

  setListeningUI(true);

  function loop() {
    analyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const s = (dataArray[i] - 128) / 128;
      sum += s * s;
    }

    const volume = Math.sqrt(sum / dataArray.length) * 32768;

    smoothedVolume = 0.82 * smoothedVolume + 0.18 * volume;
    peakVolume = Math.max(smoothedVolume, peakVolume * 0.94);
    noiseFloor = 0.985 * noiseFloor + 0.015 * smoothedVolume;
    noiseFloor = clamp(noiseFloor, 300, 16000);

    const requiredVolume = computeThreshold(noiseFloor, sensitivity);
    triggerVal.textContent = Math.round(requiredVolume).toString();

    updateVolBar(smoothedVolume);

    const now = Date.now();

    if (now - startTime >= CALIBRATION_TIME) {
      if (
        smoothedVolume >= requiredVolume &&
        peakVolume >= requiredVolume * 1.04 &&
        now - lastTrigger > COOLDOWN &&
        smoothedVolume > 500
      ) {
        playHitSoundNow();
        bumpHits();
        lastTrigger = now;
      }
    }

    animFrame = requestAnimationFrame(loop);
  }

  loop();
}

function stopListening() {
  if (!listening) return;

  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }

  analyser       = null;
  smoothedVolume = 0;
  noiseFloor     = 2000;
  peakVolume     = 0;
  listening      = false;
  triggerVal.textContent = "-";

  setListeningUI(false);
}

// ─── Controls ─────────────────────────────────────────────────────────────────
toggleBtn.addEventListener("click", () => {
  if (listening) stopListening();
  else startListening();
});

sensSlider.addEventListener("input", () => {
  sensitivity = clamp(parseFloat(sensSlider.value), SENS_MIN, SENS_MAX);
  updateSensitivityUI();
  ipcRenderer.send("set-sensitivity", sensitivity);
});

closeBtn.addEventListener("click", () => {
  ipcRenderer.send("close-window");
});

// ─── IPC from main ────────────────────────────────────────────────────────────
ipcRenderer.on("start", () => startListening());
ipcRenderer.on("stop",  () => stopListening());

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  const stored = Number(await ipcRenderer.invoke("get-sensitivity"));
  sensitivity = clamp(stored, SENS_MIN, SENS_MAX);
  sensSlider.value = sensitivity;
  updateSensitivityUI();
  triggerVal.textContent = "-";
  startListening(); // auto-start when window opens
})();