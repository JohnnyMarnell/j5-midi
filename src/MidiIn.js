const Midi = require("./Midi")
const events = require("events")

class MidiIn {
    constructor(opts) {
        this.opts = opts || {}
        this.events = new events.EventEmitter()
        this.rtmIn = Midi.newRtmDevice(opts.pattern, false, opts)
        this.name = this.rtmIn.name
        this.transpose = 0
        this.rtmIn.on("message", this.handleRtm.bind(this))
        this.handleKeyboard()
    }

    // todo: think about this more (esp performance?)
    // todo: reorder channel
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

    onHold(events, handler, seconds) {
        const millis = (seconds || 1.5) * 1000
        let holdTimer = null
        events.split(/,\s*|\s+/gi).forEach((event) => {
            this.events.on(event, msg => {
                if (Midi.isOn(msg)) {
                    holdTimer = setTimeout(() => {
                        handler(msg, seconds)
                    }, millis)
                } else {
                    clearTimeout(holdTimer)
                }
            })
        })
        return this
    }

    // todo: yeesh, lots of edge cases. have to go by momentary ups (noteoff, CC 0 [?]),
    //   calc and cancel hold time, wait timer at nth-click make sure no more come
    onClicks(events, numClicks, handler, opts) {
        opts = opts || {}
        const thresHold = opts.thresHold || 300
        const repeatThreshold = opts.repeatThreshold || 300
        let down = null, up = null, clicks = 0, holdTimer = null

        events.split(/,\s*|\s+/gi).forEach((event) => {
            this.events.on(event, msg => {
                if (Midi.isOn(msg)) {
                    holdTimer = setTimeout(() => {
                        handler(msg, seconds)
                    }, thresHold)
                } else {
                    clearTimeout(holdTimer)
                }
            })
        })
    }

    // todo: must account for non double click, etc
    onPress(events, handler, opts) {
        this.onClicks(events, 1, handler)
    }

    onDoubleClick(events, handler) {
        this.onClicks(events, 2, handler)
    }

    onTripleClick(events, handler) {
        this.onClicks(events, 3, handler)
    }

    // todo: use onPress
    onToggle(events, handler, numStates) {
        numStates = numStates || 2
        let state = numStates - 1
        events.split(/,\s*|\s+/gi).forEach((event) => {
            this.events.on(event, msg => {
                if (Midi.isOn(msg)) {
                    state = (state + 1) % numStates
                    handler(state, msg, numStates)
                }
            })
        })
        return this
    }

    simulate(msg, delay, unmarked) {
        const rtmData = [msg.status, msg.data, msg.value] // todo cover more cases
        msg.simulated = !unmarked
        if (delay) {
            setTimeout(() => this.handleMessage(msg, NaN, rtmData), delay)
        } else {
            this.handleMessage(msg, NaN, rtmData)
        }
    }

    setTranspose(amount) {
        this.transpose = amount
    }

    handleRtm(dt, data) {
        console.log('wtf ohgod', dt, data)
        if (Midi.isSysEx(data)) {
            this.events.emit("sysex", data, dt, this)
            this.events.emit("rtm", data, dt, this)
        } else {
            let msg = Midi.translateFromRtMessage(dt, data)
            this.handleMessage(msg, dt, data)
        }
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
        if (Midi.isNote(msg) && msg.channel !== 9) {
            msg.data += this.transpose
        }
        this.fireEvents(msg, dt, data, this)
        this.events.emit("rtm", data, dt, this)
    }

    handleKeyboard() {
        const midiMap = {
            z: Midi.note(Midi.Drum.KICK, 9, false, 127),
            x: Midi.note(Midi.Drum.SNARE, 9, false, 127),
            '.': Midi.note(Midi.Drum.HIHAT, 9, false, 127),
            '/': Midi.note(Midi.Drum.HIHAT_OPEN, 9, false, 127),
            'c': Midi.cc(106, 0, 127),
            'v': Midi.cc(107, 0, 127),
            'm': Midi.cc(104, 0, 127),
            ',': Midi.cc(105, 0, 127),
        }
        if (this.opts.kb) {
            const stdin = process.stdin
            if (stdin.setRawMode) {
                stdin.setRawMode(true)
            }
            stdin.resume()
            stdin.on('data', key => {
                const str = key.toString('utf8')
                if (str.charCodeAt(0) === 3) { // Ctrl-C
                    process.exit(0)
                }
                let msg = midiMap[str]
                if (msg) {
                    this.simulate(Midi.clone(msg), 0, true)
                    this.simulate(Midi.isNote(msg) ? Midi.note(msg.data, msg.channel, true) : Midi.cc(msg.data, 0), 10, true)
                }
            })
        }
    }

    close() {
        this.rtmIn.closePort()
    }
}
module.exports = MidiIn
