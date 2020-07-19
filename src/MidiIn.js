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
    }

    simulate(msg, delay) {
        delay = delay || 0
        setTimeout(() => {
            this.intitializeMidiEvent(msg)
            this.fireEvents(msg, "todo", Midi.toRtmArray(msg), this)
        }, delay)
    }

    initRtmIn() {
        this.rtmIn.on("message", (dt, data) => {
            if (Midi.isSysEx(data)) {
                this.events.emit("sysex", data, dt, this)
            } else {
                let msg = Midi.translateFromRtMessage(dt, data)
                msg = Midi.cleanMessage(msg)
                this.initializeMidiEvent(msg)
                if (this.opts.verbose) {
                    console.log(Midi.messageText(msg), data)
                }
                this.fireEvents(msg, dt, data, this)
            }
            this.events.emit("rtm", data, dt, this)
        })
    }

    initializeMidiEvent(msg) {
        Midi.intitializeMidiEvent(
            msg,
            this.startTime,
            this.totalTime,
            this.name
        )
    }

    timestampMessage(msg) {
        let hrtime = process.hrtime()
        let now = Midi.now()
        if (this.totalTime == 0) {
            this.startTime = now
            this.startTimeMillis = now
            this.startHrTimeSeconds = hrtime[0]
            this.startHrTimeNanos = hrtime[1]
        }
        let msgTime
        if (this.opts.wallClockAlways || (dt == 0 && this.opts.wallClock)) {
            msgTime = now
            this.driftTime = now - msgTime
        } else {
            this.totalTime += dt
            msgTime = Math.round(this.startTime + this.totalTime * 1000)
            this.driftTime = now - msgTime
            this.lastDt = dt
        }
        Object.assign(msg, {
            time: msgTime,
            totalTime: this.totalTime,
            driftTime: this.driftTime,
            input: this.name,
        })
    }

    close() {
        this.rtmIn.closePort()
    }
}
module.exports = MidiIn
