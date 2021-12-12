const Midi = require("./Midi")
const events = require("events")

class MidiIn {
    constructor(opts) {
        this.opts = opts
        this.events = new events.EventEmitter()
        this.rtmIn = Midi.newRtmDevice(opts.pattern, false, opts)
        this.name = this.rtmIn.name
        this.momentaryToggles = {}
        this.exclusiveEvents = {}
        this.initRtmIn()
    }

    // todo: think about this more (esp performance?)
    fireEvents(msg, dt, rtmData, input) {
        let type = Midi.type(msg)
        let key = `midi.${type}.${msg.channel}.${msg.data}`
        let cc = Midi.isCC(msg)
        let note = Midi.isNote(msg)
        if (this.opts.momentaryToggle && cc && this.opts.momentaryToggle.indexOf(msg.data) >= 0) {
            if (!msg.value || msg.value < 64) {
                return
            }
            this.momentaryToggles[key] = !this.momentaryToggles[key]
            msg.value = this.momentaryToggles[key] ? 127 : 0
        }
        const events = Array(
            `midi`,
            `midi.${type}`,
            `midi.${type}.*.${msg.data}`,
            `midi.${type}.${msg.channel}`,
            `midi.${type}.${msg.channel}.${msg.data}`,
            key,
        )
        if (cc) {
            const ccEvent = msg.value >= 64 ? 'ccon' : 'ccoff'
            events.push(
                `midi.${ccEvent}`,
                `midi.${ccEvent}.*.${msg.data}`,
                `midi.${ccEvent}.${msg.channel}`,
                `midi.${ccEvent}.${msg.channel}.${msg.data}`,
            )
        }
        else if (!note) {
            events.push(`midi.other`)
        }
        let exclusive = events.find(event => this.exclusiveEvents[event])
        if (exclusive) {
            this.events.emit(exclusive, msg, dt, rtmData, input)
        } else {
            events.forEach((event) => {
                this.events.emit(event, msg, dt, rtmData, input)
            })
        }
    }

    on(events, handler, exclusive) {
        events.split(/,\s*|\s+/gi).forEach((event) => {
            if (exclusive) {
                this.exclusiveEvents[event] = true
            }
            this.events.on(event, handler)
        })
        return this
    }

    simulate(msg, delay) {
        const rtmData = [msg.status, msg.data, msg.value] // todo cover more cases
        msg.simulated = true
        if (delay) {
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
