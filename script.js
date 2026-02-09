let port, reader, writer;
let isConnected = false;

function setStatus(text, color = "#fff") {
  const el = document.getElementById("status");
  el.textContent = text.toLowerCase();
  el.style.background = color === "green" ? "#0a0" :
                        color === "red"   ? "#a00" : "#222";
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
  send([
    0x90 | portNum,
    mask & 0x7F,
    (mask >> 7) & 0x7F
  ]);
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
  ACCEL_X: 0,
  ACCEL_Y: 0,
  ACCEL_Z: 0,
  NEOPIXELS: 8
};

function neopixelSetPixel(i, r, g, b) {
  console.log(`Set pixel ${i} → rgb(${r},${g},${b})`);
}

function neopixelShow() {
  console.log("Show NeoPixels");
}

const boardState = {
  buttonA: 0,
  buttonB: 0,
  switch: 0,
  light: 0,
  temperature: 0
};

function handleDigital(port, value) {
  boardState.buttonA = (value >> (CPX.BUTTON_A % 8)) & 1;
  boardState.buttonB = (value >> (CPX.BUTTON_B % 8)) & 1;
  boardState.switch  = (value >> (CPX.SWITCH % 8)) & 1;
  console.log("Buttons:", boardState.buttonA, boardState.buttonB, "Switch:", boardState.switch);
}

function handleAnalog(pin, value) {
  if (pin === CPX.LIGHT_SENSOR) boardState.light = value;
  if (pin === CPX.TEMP_SENSOR) boardState.temperature = value;
  console.log("Analog:", pin, value);
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
  } finally {
    reader.releaseLock();
  }
}

document.getElementById("connect").onclick = async () => {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 57600 });

    writer = port.writable.getWriter();
    isConnected = true;
    setStatus("paired", "green");

    digitalReadEnable(0);
    digitalReadEnable(1);
    analogReadEnable(CPX.LIGHT_SENSOR);
    analogReadEnable(CPX.TEMP_SENSOR);

    readLoop();
  } catch (err) {
    console.error(err);
    setStatus("failed pair, "red");
  }
};

let ledState = 0;

document.getElementById("toggle").onclick = () => {
  ledState = ledState ? 0 : 1;
  digitalWrite(CPX.LED, ledState);
};
