const VERSION = "1.0.1";
let port, reader, writer;
let isConnected = false;
let buzzerInterval = null;
let neopixelBrightness = 128;
let capabilityPins = [];
let analogChannels = [];
let digitalPorts = {};
let mapped = {
  buttonA: null,
  buttonB: null,
  slideSwitch: null,
  light: null,
  temp: null,
  sound: null,
  buzzerPin: null,
  neoSupported: false
};
let boardState = { digitalPorts: {}, analog: {} };
let incomingBuffer = [];
let sysexListeners = [];

function log(msg) {
  const el = document.getElementById("log");
  el.textContent = (el.textContent ? el.textContent + "\n" : "") + String(msg);
  el.scrollTop = el.scrollHeight;
}

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
  const bitPosition = pin % 8;
  let portState = boardState.digitalPorts[portNum] || 0;
  if (value) {
    portState |= (1 << bitPosition);
  } else {
    portState &= ~(1 << bitPosition);
  }
  boardState.digitalPorts[portNum] = portState;
  send([0x90 | portNum, portState & 0x7F, (portState >> 7) & 0x7F]);
}

function analogWrite(pin, value) {
  const lsb = value & 0x7F;
  const msb = (value >> 7) & 0x7F;
  send([0xE0 | pin, lsb, msb]);
}

function analogReadEnable(channel) {
  send([0xC0 | channel, 1]);
}

function digitalReadEnable(portNum) {
  send([0xD0 | portNum, 1]);
}

function enqueueSysexListener(matchId) {
  return new Promise(resolve => {
    sysexListeners.push({ id: matchId, resolve });
  });
}

function processIncomingBytes(bytes) {
  for (let b of bytes) {
    incomingBuffer.push(b);
    if (incomingBuffer[0] === 0xF0) {
      const endIndex = incomingBuffer.indexOf(0xF7);
      if (endIndex !== -1) {
        const sysex = incomingBuffer.slice(0, endIndex + 1);
        incomingBuffer = incomingBuffer.slice(endIndex + 1);
        handleSysex(sysex);
        continue;
      }
    }
    if ((incomingBuffer[0] & 0xF0) === 0x90 && incomingBuffer.length >= 3) {
      const portNum = incomingBuffer[0] & 0x0F;
      const val = incomingBuffer[1] | (incomingBuffer[2] << 7);
      boardState.digitalPorts[portNum] = val;
      handleDigital(portNum, val);
      incomingBuffer = incomingBuffer.slice(3);
      continue;
    }
    if ((incomingBuffer[0] & 0xF0) === 0xE0 && incomingBuffer.length >= 3) {
      const pin = incomingBuffer[0] & 0x0F;
      const val = incomingBuffer[1] | (incomingBuffer[2] << 7);
      boardState.analog[pin] = val;
      handleAnalog(pin, val);
      incomingBuffer = incomingBuffer.slice(3);
      continue;
    }
    if (incomingBuffer.length > 512) incomingBuffer = [];
  }
}

function handleSysex(sysex) {
  const id = sysex[1];
  document.getElementById("capRaw").textContent = JSON.stringify(Array.from(sysex));
  for (let i = 0; i < sysexListeners.length; i++) {
    const l = sysexListeners[i];
    if (l.id === null || l.id === id) {
      l.resolve(sysex);
      sysexListeners.splice(i, 1);
      i--;
    }
  }
  if (id === 0x6C) parseCapabilities(new Uint8Array(sysex));
}

function handleDigital(port, value) {
  document.getElementById("digitalRaw").textContent = JSON.stringify(boardState.digitalPorts);
  if (mapped.buttonA !== null) {
    const v = (value >> (mapped.buttonA % 8)) & 1;
    document.getElementById("btnA").textContent = v;
  }
  if (mapped.buttonB !== null) {
    const v = (value >> (mapped.buttonB % 8)) & 1;
    document.getElementById("btnB").textContent = v;
  }
  if (mapped.slideSwitch !== null) {
    const v = (value >> (mapped.slideSwitch % 8)) & 1;
    document.getElementById("sw").textContent = v;
  }
}

function handleAnalog(pin, value) {
  if (mapped.light === pin) {
    document.getElementById("lightRaw").textContent = value;
    const pct = Math.round((value / 1023) * 100);
    document.getElementById("lightPct").textContent = `${pct}%`;
  }
  if (mapped.temp === pin) {
    document.getElementById("tempRaw").textContent = value;
    const c = ((value / 1023) * 100) - 50;
    const f = (c * 9 / 5) + 32;
    document.getElementById("tempC").textContent = `${c.toFixed(1)}°C`;
    document.getElementById("tempF").textContent = `${f.toFixed(1)}°F`;
  }
  if (mapped.sound === pin) {
    document.getElementById("soundRaw").textContent = value;
  }
}

async function readerLoop() {
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      processIncomingBytes(value);
    }
  } catch (e) {
    log("reader error " + e);
  } finally {
    try { reader.releaseLock(); } catch (e) {}
  }
}

async function queryCapabilities() {
  if (!writer) return null;
  const p = enqueueSysexListener(0x6C);
  send([0xF0, 0x6B, 0xF7]);
  const sysex = await p;
  return sysex;
}

function parseCapabilities(bytes) {
  let i = 0;
  while (i < bytes.length && bytes[i] !== 0xF0) i++;
  if (bytes[i] !== 0xF0) return [];
  i++;
  const response = bytes[i++];
  if (response !== 0x6C) return [];
  const pins = [];
  while (i < bytes.length && bytes[i] !== 0xF7) {
    const modes = [];
    while (i < bytes.length && bytes[i] !== 0x7F) {
      const mode = bytes[i++];
      const resolution = bytes[i++];
      modes.push({ mode, resolution });
    }
    i++;
    pins.push(modes);
  }
  capabilityPins = pins;
  buildMaps();
  document.getElementById("analogMap").textContent = JSON.stringify({ analogChannels, digitalPorts }, null, 2);
  return pins;
}

function buildMaps() {
  analogChannels = [];
  digitalPorts = {};
  mapped.buzzerPin = null;
  for (let pinIndex = 0; pinIndex < capabilityPins.length; pinIndex++) {
    const modes = capabilityPins[pinIndex].map(m => m.mode);
    const hasDigital = modes.includes(0); 
    const hasAnalog = modes.includes(2) || modes.includes(1); 
    const hasPWM = modes.includes(3);
    if (hasAnalog) analogChannels.push(pinIndex);
    if (hasPWM && mapped.buzzerPin === null) mapped.buzzerPin = pinIndex;
    if (hasDigital) {
      const portNum = Math.floor(pinIndex / 8);
      digitalPorts[portNum] = digitalPorts[portNum] || [];
      digitalPorts[portNum].push(pinIndex);
    }
  }
  log(`buildMaps: analogChannels=${JSON.stringify(analogChannels)} buzzerPin=${mapped.buzzerPin} digitalPorts=${JSON.stringify(digitalPorts)}`);
}

function enableAllReports() {
  Object.keys(digitalPorts).forEach(p => digitalReadEnable(Number(p)));
  analogChannels.forEach(ch => analogReadEnable(ch));
}

document.getElementById("connect").onclick = async () => {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 57600 });
    writer = port.writable.getWriter();
    reader = port.readable.getReader();
    isConnected = true;
    setStatus("paired", "green");
    readerLoop();
    document.getElementById("jsVersion").textContent = VERSION;
  } catch (err) {
    log(err);
    setStatus("failed pair", "red");
  }
};

document.getElementById("queryCaps").onclick = async () => {
  if (!port) return;
  const sysex = await queryCapabilities();
  document.getElementById("capRaw").textContent = JSON.stringify(Array.from(sysex));
  enableAllReports();
};

document.getElementById("toggle").onclick = () => {
  if (!isConnected) return;
  let ledState = boardState.ledState ? 0 : 1;
  boardState.ledState = ledState;
  digitalWrite(13, ledState);
};

document.getElementById("npSet").onclick = () => {
  const idx = parseInt(document.getElementById("npIndex").value || "0", 10);
  const hex = document.getElementById("npColor").value || "#ff0000";
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  const br = neopixelBrightness / 255;
  const rr = Math.round(r * br);
  const gg = Math.round(g * br);
  const bb = Math.round(b * br);
  log(`neo set ${idx} rgb(${rr},${gg},${bb})`);
  document.getElementById("neoStatus").textContent = "neo: placeholder (firmware SYSEX required)";
};

document.getElementById("npShow").onclick = () => {
  log("neo show placeholder");
  document.getElementById("neoStatus").textContent = "neo: placeholder (firmware SYSEX required)";
};

document.getElementById("npBrightness").addEventListener("input", (e) => {
  neopixelBrightness = parseInt(e.target.value, 10) || 128;
});

function startBuzzer(freq) {
  stopBuzzer();
  if (!isConnected) return;
  if (mapped.buzzerPin !== null) {
    const pwmPin = mapped.buzzerPin;
    const period = 1000 / freq;
    buzzerInterval = setInterval(() => {
      analogWrite(pwmPin, 255);
      setTimeout(() => analogWrite(pwmPin, 0), period / 2);
    }, period);
    document.getElementById("buzzerStatus").textContent = `buzzer: pwm on pin ${pwmPin}`;
    return;
  }
  const period = 1000 / freq;
  let state = 0;
  buzzerInterval = setInterval(() => {
    state = state ? 0 : 1;
    digitalWrite(mapped.buzzerPin || 6, state);
  }, period / 2);
  document.getElementById("buzzerStatus").textContent = `buzzer: toggling pin ${mapped.buzzerPin || 6}`;
}

function stopBuzzer() {
  if (buzzerInterval) {
    clearInterval(buzzerInterval);
    buzzerInterval = null;
    if (mapped.buzzerPin !== null) analogWrite(mapped.buzzerPin, 0);
    else digitalWrite(mapped.buzzerPin || 6, 0);
    document.getElementById("buzzerStatus").textContent = "buzzer: idle";
  }
}

async function autoDetectInputs() {
  if (!isConnected) return;
  setStatus("detecting", "");
  const baseline = { analog: {}, digital: {} };
  analogChannels.forEach(ch => baseline.analog[ch] = boardState.analog[ch] || 0);
  Object.keys(digitalPorts).forEach(p => baseline.digital[p] = boardState.digitalPorts[p] || 0);
  log("baseline captured, now interact with board (press A, B, flip switch, change light, make sound)");
  await new Promise(r => setTimeout(r, 1200));
  const changes = { analog: {}, digital: {} };
  const start = Date.now();
  while (Date.now() - start < 7000) {
    analogChannels.forEach(ch => {
      const v = boardState.analog[ch] || 0;
      if (Math.abs(v - (baseline.analog[ch] || 0)) > 10) changes.analog[ch] = v;
    });
    Object.keys(digitalPorts).forEach(p => {
      const v = boardState.digitalPorts[p] || 0;
      if (v !== (baseline.digital[p] || 0)) changes.digital[p] = v;
    });
    await new Promise(r => setTimeout(r, 200));
  }
  log("detect results " + JSON.stringify(changes));
  if (Object.keys(changes.digital).length) {
    const ports = Object.keys(changes.digital).map(Number);
    const p = ports[0];
    const val = changes.digital[p];
    const pins = digitalPorts[p] || [];
    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      const bit = (val >> (pin % 8)) & 1;
      if (bit === 1) {
        if (mapped.buttonA === null) mapped.buttonA = pin;
        else if (mapped.buttonB === null) mapped.buttonB = pin;
        else if (mapped.slideSwitch === null) mapped.slideSwitch = pin;
      }
    }
  }
  if (Object.keys(changes.analog).length) {
    const keys = Object.keys(changes.analog).map(Number);
    if (keys.length >= 1 && mapped.light === null) mapped.light = keys[0];
    if (keys.length >= 2 && mapped.temp === null) mapped.temp = keys[1];
    if (keys.length >= 3 && mapped.sound === null) mapped.sound = keys[2];
  }
  document.getElementById("analogMap").textContent = JSON.stringify({ mapped, analogChannels, digitalPorts }, null, 2);
  setStatus("paired", "green");
  updateUI();
}

document.getElementById("autoDetect").onclick = autoDetectInputs;

function updateUI() {
  if (mapped.buttonA !== null) document.getElementById("btnA").textContent = mapped.buttonA;
  if (mapped.buttonB !== null) document.getElementById("btnB").textContent = mapped.buttonB;
  if (mapped.slideSwitch !== null) document.getElementById("sw").textContent = mapped.slideSwitch;
  if (mapped.light !== null) document.getElementById("lightRaw").textContent = boardState.analog[mapped.light] || 0;
  if (mapped.temp !== null) {
    const v = boardState.analog[mapped.temp] || 0;
    document.getElementById("tempRaw").textContent = v;
    const c = ((v / 1023) * 100) - 50;
    const f = (c * 9 / 5) + 32;
    document.getElementById("tempC").textContent = `${c.toFixed(1)}°C`;
    document.getElementById("tempF").textContent = `${f.toFixed(1)}°F`;
  }
  if (mapped.sound !== null) document.getElementById("soundRaw").textContent = boardState.analog[mapped.sound] || 0;
}

setStatus("unpaired", "");
document.getElementById("jsVersion").textContent = VERSION;
