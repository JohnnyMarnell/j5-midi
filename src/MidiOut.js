const Midi = require("./Midi")

class MidiOut {
    constructor(opts) {
        this.opts = opts
        this.rtmOut = Midi.newRtmDevice(this.opts.pattern, true, this.opts)
        this.name = this.rtmOut.name
        this.noteOns = (new Array(Midi.Types.NUM_CHANNELS))
            .fill().map(c => (new Array(Midi.MAX)).fill().map(v => null))
    }

    send(msg) {
        if (msg) {
            let rtmArray = Midi.toRtmArray(msg)
            if (this.opts.verbose) {
                console.log(
                    "to output:",
                    this.name,
                    Midi.messageText(msg),
                    msg,
                    JSON.stringify(rtmArray)
                )
            }
            this.rtmSend(rtmArray)
            if (Midi.isNoteOn(msg)) this.noteOns[msg.channel][msg.data] = msg
            else if (Midi.isNoteOff(msg)) this.noteOns[msg.channel][msg.data] = null
        }
    }

    sendMessage(msg) {
        this.send(msg)
    }

    rtmSend(rtmArray) {
        this.rtmOut.sendMessage(rtmArray)
        return this
    }

    sendSysEx(str) {
        // console.log('SysExSend', str)
        this.rtmSend([
            Midi.Types.SYSEX_START,
            ...Array.from(str).map(c => c.charCodeAt(0)),
            Midi.Types.SYSEX_END
        ])
        return this
    }

    sendNoteOn(channel, note, velocity) {
        this.sendMessage(Midi.note(note, channel, false, velocity || 127))
    }

    sendNoteOff(channel, note) {
        this.sendMessage(Midi.note(note, channel, true, 0))
    }

    sendNote(channel, note, velocity) {
        return velocity === 0 ? this.sendNoteOff(channel, note) : this.sendNoteOn(channel, note, velocity)
    }

    sendCC(channel, cc, val) {
        if (typeof val === "undefined") {
            val = 127
        }
        this.sendMessage(Midi.cc(cc, channel, val))
    }

    playNote(channel, note, duration, velocity) {
        if (channel.type) {
            let msg = channel
            note = msg.data
            velocity = msg.value
            channel = msg.channel
        }
        this.sendNoteOn(channel, note, velocity)
        if (duration) {
            return setTimeout(() => this.sendNoteOff(channel, note), duration)
        } else {
            this.sendNoteOff(channel, note)
        }
    }

    forEachNoteOn(callback) {
        this.noteOns.flatMap(list => list).filter(msg => msg).forEach(callback)
    }

    silence() {
        this.forEachNoteOn(msg => this.send(Midi.note(msg.data, msg.channel, true)))
    }

    transformAndReplay(transform) {
        this.forEachNoteOn(msg => {
            this.send(Midi.note(msg.data, msg.channel, true))
            this.send(transform(msg))
        })
    }

    panic() {
        this.silence()
        for (let channel = 0; channel < Midi.Types.NUM_CHANNELS; channel++) {
            this.out.send(Midi.cc(123, channel, 0))
            this.out.send(Midi.cc(120, channel, 0))
            for (let note = 0; note < Midi.Types.MAX; note++) {
                this.out.send(Midi.note(note, channel, true))
            }
        }
    }

    close() {
        this.rtmOut.closePort()
    }
}

module.exports = MidiOut
