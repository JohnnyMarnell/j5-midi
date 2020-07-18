const { MidiIn, MidiOut, Midi } = require("../")
const input = new MidiIn({ pattern: /LaunchKey/gi })
const synth = new MidiOut({ pattern: /FluidSynth/gi })
let transposeAmount = 0

// transpose the notes on the fly by adding delta
input.on("midi.noteon.*, midi.noteoff.*", (msg) => {
    msg.data += transposeAmount
    synth.send(msg)
})
input.on("midi", (msg) => console.log("Received midi message:", Midi.messageText(msg)))

// set the amount / delta to transpose by listening to a knob (e.g. Midi CC 21)
input.on("midi.cc.*.21", (msg) => (transposeAmount = Math.floor(msg.value / 11)))