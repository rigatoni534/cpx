function digitalWrite(pin, value) {
    // Assume pin is in the range 0-13 for a 4-bit port
    const port = Math.floor(pin / 8); // determine the port (0 or 1)
    const pinMask = 1 << (pin % 8); // create a bitmask for the specific pin

    // Read current port state
    let portState = readPort(port); // Assume readPort is a function that returns the current byte of the port state

    // Modify the state based on the value
    if (value === 0) {
        portState &= ~pinMask; // Clear the bit for LOW
    } else {
        portState |= pinMask; // Set the bit for HIGH
    }

    // Write the modified state back to the port
    writePort(port, portState); // Assume writePort is a function to set the state of the entire port
}