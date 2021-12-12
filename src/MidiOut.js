const Midi = require("./Midi")

class MidiOut {
    constructor(opts) {
        this.opts = opts
        this.rtmOut = Midi.newRtmDevice(this.opts.pattern, true, this.opts)
        this.name = this.rtmOut.name
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
        }
    }

    sendMessage(msg) {
        this.send(msg)
    }

    rtmSend(rtmArray) {
        this.rtmOut.sendMessage(rtmArray)
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
        if (typeof val == "undefined") {
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

    close() {
        this.rtmOut.closePort()
    }
}

module.exports = MidiOut
