let port, writer;
let ledState = 0;

function digitalWrite(pin, value) {
  const portNum = Math.floor(pin / 8);
  const mask = value ? (1 << (pin % 8)) : 0;

  const msg = new Uint8Array([
    0x90 | portNum,
    mask & 0x7F,
    (mask >> 7) & 0x7F
  ]);

  writer.write(msg);
}

document.getElementById("connect").onclick = async () => {
  port = await navigator.serial.requestPort();
  await port.open({ baudRate: 57600 });

  writer = port.writable.getWriter();
  console.log("Connected to CPX");
};

document.getElementById("toggle").onclick = () => {
  ledState = ledState ? 0 : 1;
  digitalWrite(13, ledState);
};
