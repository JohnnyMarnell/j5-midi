const { MidiIn, MidiOut, Midi } = require("../")
const input = new MidiIn({ pattern: /LaunchKey|Korg|Akai/gi })
const synth = new MidiOut({ pattern: /FluidSynth/gi })
let transposeAmount = 0

// Transpose the notes on the fly by adding a transpose amount / delta
input.on("midi.noteon midi.noteoff", (msg) => {
    msg.data += transposeAmount
    synth.send(msg)
})

// Set the amount / delta to transpose by listening to a knob (e.g. Midi CC 21)
input.on("midi.cc.*.21", msg => transposeAmount = Math.floor(msg.value / 11))

// Print any midi message
input.on("midi", msg => console.log("Received midi:", Midi.messageText(msg)))