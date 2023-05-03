const Midi = require('./Midi')
const events = require('events')
const fs = require('fs')
const zlib = require('zlib')

class MidiIn {
    constructor(opts) {
        this.opts = opts
        this.events = new events.EventEmitter()
        this.rtmIn = Midi.newRtmDevice(opts.pattern, false, opts)
        this.name = this.rtmIn.name
        this.momentaryToggles = {}
        this.exclusiveEvents = {}
        this.require = null
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
            key,
        )
        const extra = cc ? (msg.value >= 64 ? 'ccon' : 'ccoff') :
            note ? 'note' : null
        if (extra) {
            events.push(
                `midi.${extra}`,
                `midi.${extra}.*.${msg.data}`,
                `midi.${extra}.${msg.channel}`,
                `midi.${extra}.${msg.channel}.${msg.data}`,
            )
        }
        else if (!note) {
            events.push(`midi.other`)
        }

        let exclusive = events.find(event => this.exclusiveEvents[event])
        if (exclusive) {
            this.events.emit(exclusive, msg, dt, rtmData, input)
        } else {
            events.forEach(event => {
                this.events.emit(event, msg, dt, rtmData, input)
            })
        }
    }

    on(events, handler, opts = {}) {
        if (opts.when) {
            const condition = opts.when
            const originalHandler = handler
            if (opts.otherwise) {
                handler = (...args) => {
                    if (condition(...args)) {
                        originalHandler(...args)
                    } else {
                        opts.otherwise(...args)
                    }
                }
            } else {
                handler = (...args) => {
                    if (condition(...args)) {
                        originalHandler(...args)
                    }
                }
            }
        }
        else if (this.require) {
            const condition = this.require
            const originalHandler = handler
            handler = (...args) => {
                if (condition(...args)) {
                    originalHandler(...args)
                }
            }
        }
        // console.log('Is there a requirement for', events, '?', !!this.require)
        events.split(/,\s*|\s+/gi).forEach((event) => {
            if (event === "sysex" && typeof this.opts.emitSysEx === "undefined") {
                this.opts.emitSysEx = true
            } else if (event === "rtm" && typeof this.opts.emitRtmData === "undefined") {
                this.opts.emitRtmData = true
            } else if (event === "midiBeatClock" && typeof this.opts.emitMidiBeatClock === "undefined") {
                this.opts.emitMidiBeatClock = true
            }

            if (opts.exclusive) {
                this.exclusiveEvents[event] = true
            }
            this.events.on(event, handler)
        })
        return this
    }

    onHeld(event, handler, secs = 1) {
        let timer = null
        const time = secs * 1000
        const type = t => event.replace(/(on|off)/ig, '')
            .replace(/(cc|note)/ig, `$1${t}`)
        this.on(type('on'), msg => timer = setTimeout(() => handler(msg), time))
        this.on(type('off'), msg => clearTimeout(timer))
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
            try {
                if (this.opts.emitRtmData) {
                    this.events.emit("rtm", data, dt, this)
                }

                if (Midi.isSysEx(data)) {
                    if (this.opts.emitSysEx) {
                        this.events.emit("sysex", data, dt, this)
                    }
                } else if (Midi.isMidiBeatClock(data)) {
                    if (this.opts.emitMidiBeatClock) {
                        this.events.emit("midiBeatClock", data, dt, this)
                    }
                } else {
                    let msg = Midi.translateFromRtMessage(dt, data)
                    this.handleMessage(msg, dt, data)
                }
            } catch (err) {
                console.error('MIDI handler error', err)
                throw err
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
        if (MidiIn.rec && !msg.simulated) {
            MidiIn.recEvents.push(Midi.cloneMessage(msg))
        }
        this.fireEvents(msg, dt, data, this)
        this.events.emit("rtm", data, dt, this)
    }

    when(condition, callback) {
        const oldRequire = this.require
        this.require = condition
        callback(this)
        this.require = oldRequire
    }

    whenOtherwise(condition, whenCallback, otherwiseCallback) {
        when(condition, whenCallback)
        when(...args => !condition(...args), otherwiseCallback)
    }

    close() {
        this.rtmIn.closePort()
    }
}

function handleRecord() {
    MidiIn.rec = !! process.argv.find(a => a.startsWith('--j5-rec'))
    if (MidiIn.rec) {
        const path = `${process.env.HOME}/.config/j5/midi`
        fs.mkdirSync(path, {recursive: true})
        MidiIn.recEvents = []
        MidiIn.recBoot = {type: 'boot', nanos: Midi.now(), bootTimeMs: Midi.bootTimeMs, date: new Date(Midi.bootTimeMs)}
        MidiIn.recEvents.push(MidiIn.recBoot)
        const gzip = false
        MidiIn.recPath = `${path}/recordings.json${gzip ? '.gz' : ''}`
        console.error(`Recording midi events to ${MidiIn.recPath}`)
        const writeStream = fs.createWriteStream(MidiIn.recPath, {autoClose: true, flags: 'a'})
        const eventStream = gzip ? zlib.createGzip().pipe(writeStream) : writeStream

        const flush = (end = false) => {
            if (MidiIn.recEvents.length) {
                eventStream.write(MidiIn.recEvents.map(e => JSON.stringify(e)).join('\n') + '\n')
                if (eventStream.flush) {
                    eventStream.flush()
                }
                if (end) {
                    eventStream.end()
                }
                MidiIn.recEvents = []
            }
        }
        setInterval(flush, 3000)

        let shuttingDown = false
        const shutdownHook = () => {
            if (!shuttingDown) {
                shuttingDown = true
                console.error(`Flushing ${MidiIn.recEvents.length} recorded events before exit`)
                MidiIn.recEvents.push({type: "shutdown", nanos: Midi.now()})
                flush(true)
            }
        }
        process.on('exit', shutdownHook)
        process.on('SIGTERM', () => shutdownHook() || process.exit(0))
        process.on('SIGINT', () => shutdownHook() || process.exit(0))
        process.on('message', msg => msg === 'shutdown' && shutdownHook())
    }
}

handleRecord()
module.exports = MidiIn
