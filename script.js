let port, reader, writer;
let isConnected = false;
let buzzerInterval = null;
let neopixelBrightness = 128;

function setStatus(text, color = "") {
  const el = document.getElementById("status");
  el.textContent = String(text).toLowerCase();
  if (color === "green") {
    el.style.background = "#0f0";
    el.style.color = "#000";
  } else if (color === "red") {
    el.style.background = "#f00";
    el.style.color = "#000";
  } else {
    el.style.background = "#333";
    el.style.color = "#fff";
  }
}

function send(bytes) {
  if (!writer) return;
  writer.write(new Uint8Array(bytes));
}

function pinMode(pin, mode) {
  send([0xF4, pin, mode]);
}

function digitalWrite(pin, value) {
  const portNum = Math.floor(pin / 8);
  const mask = value ? (1 << (pin % 8)) : 0;
  send([0x90 | portNum, mask & 0x7F, (mask >> 7) & 0x7F]);
}

function analogReadEnable(pin) {
  send([0xC0 | pin, 1]);
}

function digitalReadEnable(portNum) {
  send([0xD0 | portNum, 1]);
}

const CPX = {
  LED: 13,
  BUTTON_A: 4,
  BUTTON_B: 5,
  SWITCH: 7,
  LIGHT_SENSOR: 17,
  TEMP_SENSOR: 16,
  SOUND_SENSOR: 15,
  NEOPIXELS: 8,
  BUZZER: 6
};

function neopixelSetPixel(i, r, g, b) {
  const br = neopixelBrightness / 255;
  const rr = Math.round(r * br);
  const gg = Math.round(g * br);
  const bb = Math.round(b * br);
  console.log(`NEO set pixel ${i} → rgb(${rr},${gg},${bb}) brightness=${neopixelBrightness}`);
}

function neopixelShow() {
  console.log("NEO show");
}

const boardState = {
  buttonA: 0,
  buttonB: 0,
  switch: 0,
  light: 0,
  temperature: 0,
  sound: 0
};

function updateUI() {
  const btnA = document.getElementById("btnA");
  const btnB = document.getElementById("btnB");
  const sw = document.getElementById("sw");
  const lightRaw = document.getElementById("lightRaw");
  const lightPct = document.getElementById("lightPct");
  const soundRaw = document.getElementById("soundRaw");
  const tempRaw = document.getElementById("tempRaw");
  const tempC = document.getElementById("tempC");
  const tempF = document.getElementById("tempF");
  if (btnA) btnA.textContent = boardState.buttonA;
  if (btnB) btnB.textContent = boardState.buttonB;
  if (sw) sw.textContent = boardState.switch;
  if (lightRaw) lightRaw.textContent = boardState.light;
  if (lightPct) {
    const pct = Math.round((boardState.light / 1023) * 100);
    lightPct.textContent = `${pct}%`;
  }
  if (soundRaw) soundRaw.textContent = boardState.sound;
  if (tempRaw) tempRaw.textContent = boardState.temperature;
  if (tempC && tempF) {
    const c = ((boardState.temperature / 1023) * 100) - 50;
    const f = (c * 9 / 5) + 32;
    tempC.textContent = `${c.toFixed(1)}°C`;
    tempF.textContent = `${f.toFixed(1)}°F`;
  }
}

function handleDigital(port, value) {
  boardState.buttonA = (value >> (CPX.BUTTON_A % 8)) & 1;
  boardState.buttonB = (value >> (CPX.BUTTON_B % 8)) & 1;
  boardState.switch = (value >> (CPX.SWITCH % 8)) & 1;
  updateUI();
}

function handleAnalog(pin, value) {
  if (pin === CPX.LIGHT_SENSOR) boardState.light = value;
  if (pin === CPX.TEMP_SENSOR) boardState.temperature = value;
  if (pin === CPX.SOUND_SENSOR) boardState.sound = value;
  updateUI();
}

async function readLoop() {
  reader = port.readable.getReader();
  let buffer = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      for (let byte of value) {
        buffer.push(byte);
        if ((buffer[0] & 0xF0) === 0x90 && buffer.length === 3) {
          const portNum = buffer[0] & 0x0F;
          const val = buffer[1] | (buffer[2] << 7);
          handleDigital(portNum, val);
          buffer = [];
        }
        if ((buffer[0] & 0xF0) === 0xE0 && buffer.length === 3) {
          const pin = buffer[0] & 0x0F;
          const val = buffer[1] | (buffer[2] << 7);
          handleAnalog(pin, val);
          buffer = [];
        }
      }
    }
  } catch (err) {
    console.error("Read error:", err);
    setStatus("read error", "red");
  } finally {
    try { reader.releaseLock(); } catch (e) {}
  }
}

document.getElementById("connect").onclick = async () => {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 57600 });
    writer = port.writable.getWriter();
    isConnected = true;
    setStatus("paired", "green");
    pinMode(CPX.LED, 1);
    pinMode(CPX.BUZZER, 1);
    digitalReadEnable(0);
    digitalReadEnable(1);
    analogReadEnable(CPX.LIGHT_SENSOR);
    analogReadEnable(CPX.TEMP_SENSOR);
    analogReadEnable(CPX.SOUND_SENSOR);
    readLoop();
  } catch (err) {
    console.error(err);
    setStatus("failed pair", "red");
  }
};

window.addEventListener("beforeunload", async () => {
  try {
    stopBuzzer();
    if (reader) try { reader.cancel(); } catch (e) {}
    if (writer) try { writer.releaseLock(); } catch (e) {}
    if (port) try { await port.close(); } catch (e) {}
  } catch (e) {}
});

let ledState = 0;
document.getElementById("toggle").onclick = () => {
  ledState = ledState ? 0 : 1;
  digitalWrite(CPX.LED, ledState);
};

document.getElementById("npSet").onclick = () => {
  const idx = parseInt(document.getElementById("npIndex").value || "0", 10);
  const hex = document.getElementById("npColor").value || "#ff0000";
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  neopixelSetPixel(idx, r, g, b);
};

document.getElementById("npShow").onclick = () => {
  neopixelShow();
};

document.getElementById("npBrightness").addEventListener("input", (e) => {
  neopixelBrightness = parseInt(e.target.value, 10) || 128;
});

function startBuzzer(freq) {
  stopBuzzer();
  if (!isConnected) return;
  const period = 1000 / freq;
  let state = 0;
  buzzerInterval = setInterval(() => {
    state = state ? 0 : 1;
    digitalWrite(CPX.BUZZER, state);
  }, period / 2);
}

function stopBuzzer() {
  if (buzzerInterval) {
    clearInterval(buzzerInterval);
    buzzerInterval = null;
    digitalWrite(CPX.BUZZER, 0);
  }
}

document.getElementById("buzzerOn").onclick = () => {
  const freq = parseInt(document.getElementById("buzzerFreq").value || "440", 10);
  startBuzzer(freq);
  setStatus("paired", "green");
};

document.getElementById("buzzerOff").onclick = () => {
  stopBuzzer();
  setStatus("paired", "green");
};

setStatus("unpaired", "");
updateUI();
