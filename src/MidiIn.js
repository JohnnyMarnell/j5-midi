const Midi = require("./Midi")
const events = require("events")

class MidiIn {
    constructor(opts) {
        this.opts = opts
        this.events = new events.EventEmitter()
        this.rtmIn = Midi.newRtmDevice(opts.pattern, false, opts)
        this.name = this.rtmIn.name
        this.initRtmIn()
    }

    // todo: think about this more (esp performance?)
    fireEvents(msg, dt, rtmData, input) {
        let type = Midi.type(msg)
        Array(
            `midi`,
            `midi.${type}`,
            `midi.${type}.*.${msg.data}`,
            `midi.${type}.${msg.channel}`,
            `midi.${type}.${msg.channel}.${msg.data}`
        ).forEach((event) => {
            this.events.emit(event, msg, dt, rtmData, input)
        })
    }

    on(events, handler) {
        events.split(/,\s*|\s+/gi).forEach((event) => {
            this.events.on(event, handler)
        })
        return this
    }

    simulate(msg, delay) {
        const rtmData = [msg.status, msg.data, msg.value] // todo cover more cases
        msg.simulated = true
        if (delay) {
            console.log('wtf using delay', delay)
            setTimeout(() => this.handleMessage(msg, NaN, rtmData), delay)
        } else {
            this.handleMessage(msg, NaN, rtmData)
        }
    }

    initRtmIn() {
        this.rtmIn.on("message", (dt, data) => {
            if (Midi.isSysEx(data)) {
                this.events.emit("sysex", data, dt, this)
                this.events.emit("rtm", data, dt, this)
            } else {
                let msg = Midi.translateFromRtMessage(dt, data)
                this.handleMessage(msg, dt, data)
            }
        })
    }

    handleMessage(msg, dt, data) {
        msg = Midi.cleanMessage(msg)
        msg.nanos = Midi.now()
        msg.input = this.name
        msg.originalChannel = msg.channel
        msg.originalData = msg.data
        if (this.opts.verbose) {
            console.log(Midi.messageText(msg), data)
        }
        this.fireEvents(msg, dt, data, this)
        this.events.emit("rtm", data, dt, this)
    }

    close() {
        this.rtmIn.closePort()
    }
}
module.exports = MidiIn
