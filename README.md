# j5-midi

Easy, convenient library for interfacing with midi devices.

An example, knob controlled transpose:
```javascript
const {MidiIn, MidiOut, Midi} = require('j5-midi')
const input = new MidiIn({pattern: /Akai|Novation/ig})
const synth = new MidiOut({pattern: /FluidSynth/ig})
let transposeAmount = 0

// transpose the notes on the fly by adding delta
input.on('midi.noteon.*, midi.noteoff.*', msg => {
    msg.data += transposeAmount
    synth.send(msg)
})
input.on('midi', msg => console.log('Received midi message:', Midi.messageText(msg)))

// set the amount / delta to transpose by listening to a knob (e.g. Midi CC 21)
input.on('midi.cc.*.21', msg => transposeAmount = Math.floor(msg.value / 11))
```

## To Do:
- Add tests, yikes
- TypeScript, oh dear
- `MidiMessage` class instead of functional approach?
- Auto reconnect for USB hot plug etc...
- Better, configurable logging
- Replace some more code with more event emitters and listeners