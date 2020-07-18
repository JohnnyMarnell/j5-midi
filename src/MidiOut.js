const Midi = require('./Midi')

class MidiOut {
    constructor(opts) {
        this.opts = Object.assign(this, {
            pattern: '.',
            rtmOut: null,
            virtual: false,
            verbose: false
        }, opts)
        if (!this.rtmOut) {
            if (this.opts.virtual) {
                this.rtmOut = Midi.newOutput(this.opts)
                this.name = this.name || 'Node.JS Virtual Input'
                this.rtmOut.openVirtualPort(this.name)
            } else {
                this.rtmOut = Midi.newRtmDevice(this.opts.pattern, true, this.opts)
            }
        }
        this.name = this.name || (this.rtmOut && this.rtmOut.name)
        if (this.opts.verbose) {
            console.log('out', this.name)
        }
    }
    send(msg) {
        if (!msg) {
            return
        }
        let rtmArray = Midi.toRtmArray(msg)
        if (this.opts.verbose) {
            console.log('to output:', this.name, Midi.messageText(msg), msg, JSON.stringify(rtmArray))
        }
        this.sendRt(rtmArray)
    }
    sendMessage(msg) { this.send(msg) }
    sendRt(rtmPayload) {
        this.rtmOut.sendMessage(rtmPayload)
        return this
    }
    sendNoteOn(channel, note, velocity) {
        this.sendMessage({type: Midi.Types.NOTE_ON, channel: channel, data: note, value: velocity || 127})
    }
    sendNoteOff(channel, note) {
        this.sendMessage({type: Midi.Types.NOTE_OFF, channel: channel, data: note, value: 0})
    }
    sendCC(channel, cc, val) {
        this.sendMessage({type: Midi.Types.CC, channel: channel, data: cc, value: typeof val == 'undefined' ? 127 : val})
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