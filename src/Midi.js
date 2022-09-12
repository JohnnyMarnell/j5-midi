const midi = require("midi")
const RtMidiDeviceProxy = require("./RtMidiDeviceProxy")

const NOTES = "C Db D Eb E F Gb G Ab A Bb B".split(" ")
const NOTES_SHARPS = "C C# D D# E F F# G G# A A# B".split(" ")
const LETTERS_TO_NOTES = {}
const LETTERS_TO_NOTES_SHARPS = {}
NOTES.forEach((letter, index) => (LETTERS_TO_NOTES[letter] = index))
NOTES_SHARPS.forEach(
    (letter, index) => (LETTERS_TO_NOTES_SHARPS[letter] = index)
)
const NANO_PER_SEC = 1e9
const SEC_PER_NANO = 1.0 / NANO_PER_SEC

const reverse = obj => Object.freeze(Object.fromEntries(Object.entries(obj).map(e => e.reverse())))

class Midi {

    static argv(name, defaultValue) {
        const index = process.argv.indexOf(`--${name}`)
        return typeof defaultValue === "undefined" ? index >= 0 : index < 0 ? defaultValue : process.argv[index + 1]
    }

    static ccDown(msg, data) {
        return msg.type == Midi.Types.CC && msg.data == data && msg.value >= 64
    }

    static ccKnob(msg, data, channel) {
        return (
            msg.type == Midi.Types.CC &&
            (Midi.isEmpty(data) || msg.data == data) &&
            (Midi.isEmpty(channel) || msg.channel == channel)
        )
    }

    static note(noteNum, channel, off, velocity) {
        return {
            type: !!off ? Midi.Types.NOTE_OFF : Midi.Types.NOTE_ON,
            data: noteNum,
            value: !!off ? 0 : velocity || 127,
            channel: channel || 0,
        }
    }

    static noteOff(msg) {
        return Midi.note(msg.data, msg.channel, true, msg.value)
    }

    static noteOn(msg) {
        return Midi.note(msg.data, msg.channel, false, msg.value)
    }

    static cc(data, channel, value) {
        return {
            type: Midi.Types.CC,
            data: data,
            channel: channel || 0,
            value: value,
        }
    }

    static isEmpty(val) {
        return !val && val !== 0 && val !== false
    }

    static translateFromRtMessage(dt, data) {
        return {
            status: data[0],
            type: data[0] & Midi.Types.TYPE_MASK,
            channel: data[0] & Midi.Types.CHANNEL_MASK,
            data: data[1],
            value: data[2],
            dt: dt
        }
    }

    static relativizeNote(msg) {
        let note = Midi.isEmpty(msg.data) ? msg : msg.data
        note = (note + 12) % 12
        return note
    }

    static noteLetter(msg) {
        return Midi.Types.NOTES[Midi.relativizeNote(msg)]
    }

    static noteNumberFromString(str) {
        let re = /(.*?)(\d+)?$/
        let letter = str.replace(re, "$1")
        let octave = parseInt(str.replace(re, "$2")) || 0
        let noteNumber =
            Midi.Types.LETTERS_TO_NOTES[letter] ||
            Midi.Types.LETTERS_TO_NOTES_SHARPS[letter]
        noteNumber += octave * 12
        return noteNumber
    }

    static sig(msg) {
        return [msg.type, msg.channel, msg.data].join("|")
    }

    static nowMs() {
        return Date.now()
    }

    static now() {
        return Midi.nanos(process.hrtime(Midi.bootTime))
    }

    static secs(nanos = null) {
        return (nanos === null ? Midi.now() : nanos) * SEC_PER_NANO
    }

    static secsStr(nanos = null, points = 2) {
        return Midi.secs(nanos).toFixed(points)
    }

    static isNote(msg) {
        return msg.type === Midi.Types.NOTE_ON || msg.type === Midi.Types.NOTE_OFF
    }

    static isNoteOn(msg, note) {
        return (
            msg.type === Midi.Types.NOTE_ON &&
            (Midi.isEmpty(note) || msg.data === note)
        )
    }

    static isLikeSnareHit(msg) {
        return Midi.isNoteOn(msg)
            && (msg.data === Midi.Drum.SNARE || msg.data === Midi.Drum.CLICK || msg.data === Midi.Drum.CLAP)
    }

    static isPerformanceMessage(msg) {
        return Midi.PerformTypesRev[msg.type] || (Midi.isCC(msg) && Midi.CC_PERFORM_REV[msg.data])
    }

    static isNoteOff(msg, note) {
        return (
            msg.type === Midi.Types.NOTE_OFF &&
            (Midi.isEmpty(note) || msg.data === note)
        )
    }

    static isOn(msg) {
        return Midi.isNoteOn(msg) || Midi.ccDown(msg, msg.data)
    }

    static isCC(msg) {
        return msg.type === Midi.Types.CC
    }

    static isProgram(msg) {
        return msg.type === Midi.Types.PROGRAM
    }

    static isChannelAfterTouch(msg) {
        return msg.type === Midi.Types.CHANNEL_AFTER
    }

    static isMidiBeatClock(rtmData) {
        const status = rtmData[0] //           clocl       start,   continue,   stop
        return rtmData.length === 1 && status === 0xF8 || status >= 0xFA && status <= 0xFC
    }

    static isSysEx(rtmData) {
        return rtmData[0] === Midi.Types.SYSEX_START && rtmData[rtmData.length - 1] === Midi.Types.SYSEX_END
    }

    // match a noteOn or a cc press (high)
    static on(target, msg) {
        return (
            ((Midi.isNote(target) && Midi.isNoteOn(msg)) ||
                (Midi.isCC(target) && msg.value >= 64)) &&
            (Midi.isEmpty(target.data) || target.data === msg.data) &&
            (Midi.isEmpty(target.channel) || target.channel === msg.channel)
        )
    }

    // match a noteOff or a cc release (low)
    static off(target, msg) {
        return (
            ((Midi.isNote(target) && Midi.isNoteOff(msg)) ||
                (Midi.isCC(target) && msg.value < 64)) &&
            (Midi.isEmpty(target.data) || target.data === msg.data) &&
            (Midi.isEmpty(target.channel) || target.channel === msg.channel)
        )
    }

    static when(target, msg) {
        return (
            (!target.type || target.type == msg.type) &&
            (Midi.isEmpty(target.data) || target.data == msg.data) &&
            (Midi.isEmpty(target.channel) || target.channel == msg.channel) &&
            (Midi.isEmpty(target.value) || target.value == msg.value)
        )
    }

    static fuzzy(target, msg) {
        return (
            target.data == msg.data &&
            target.channel == msg.channel &&
            (target.type == msg.type ||
                (Midi.isNote(target) && Midi.isNote(msg)))
        )
    }

    static convert(target, source) {
        target = Midi.cloneMessage(target)
        let on = Midi.ccDown(source) || Midi.isNoteOn(source)
        if (Midi.isNote(target)) {
            if (on) {
                target.type = Midi.Types.NOTE_ON
                target.value = target.value || 100
            } else {
                target.type = Midi.Types.NOTE_OFF
                target.value = 0
            }
        } else if (Midi.isCC(target)) {
            target.value = on ? 127 : 0
        } else {
            console.error(
                "ERROR: Don't know how to convert",
                Midi.desc(source),
                "to",
                Midi.desc(target)
            )
        }
        return target
    }

    static program(program, channel) {
        return {
            type: Midi.Types.PROGRAM,
            data: program,
            channel: channel || 0,
        }
    }

    static type(msg) {
        return Midi.TypeNames[msg.type] || "unknown"
    }

    static parse(str) {
        str = str.toString().split(" ")
        let type = str[0],
            msg,
            [val1, val2, val3] = str.slice(1).map((s) => parseInt(s))
        if (type == Midi.TypeNames[Midi.Types.CC]) {
            msg = Midi.cc(val2, val1, val3)
        } else if (type == Midi.TypeNames[Midi.Types.PROGRAM]) {
            msg = Midi.program(val2, val1)
        } else {
            const off = Midi.TypeNames[Midi.Types.NOTE_OFF] == type.toLowerCase()
            msg = Midi.note(val2, val1, off, val3)
        }
        return msg
    }

    static desc(msg) {
        return [Midi.type(msg), msg.channel, msg.data, msg.value].join(" ")
    }

    static short(msg) {
        return [
            Midi.isNoteOn(msg) ? "noteon" : Midi.isNoteOff(msg) ? "noteoff" : Midi.type(msg),
            msg.channel,
            msg.data,
            msg.value
        ].join(" ")
    }

    static log(msg) {
        console.log(Midi.short(msg))
        return msg
    }

    static fluidCommand(msg) {
        return `${this.type(msg)} ${msg.channel} ${msg.data} ${msg.value}\n`
    }

    static setChannel(msg, channel) {
        msg.channel = channel
        msg.status = msg.type + msg.channel
        return msg
    }

    static transpose(msg, amt) {
        msg.data += amt
        return msg
    }

    // todo jmarnell: beterrize
    static transposeWithin(msg, min, numOctaves) {
        while (msg.data < min) msg.data += 12
        while (msg.data > min + numOctaves * 12) msg.data -= 12
        return msg
    }

    static setType(msg, type) {
        msg.type = type
        msg.status = msg.type + msg.channel
        return msg
    }

    static messageText(msg) {
        return Array(
            Object.keys(Midi.Types).find((key) => Midi.Types[key] == msg.type),
            Midi.isNote(msg) ? Midi.noteLetter(msg) : msg.data,
            msg.value
        ).join(" ")
    }

    static cloneMessage(msg, value) {
        msg = JSON.parse(JSON.stringify(msg)) // todo un-dumb this
        if (!Midi.isEmpty(value)) {
            msg.value = value
        }
        return msg
    }

    static inverse(msg) {
        msg = Midi.cloneMessage(msg)
        if (Midi.isEmpty(msg.value)) {
            msg.value = 127
        }
        return Midi.cloneMessage(msg, !msg.value ? 127 : 0)
    }

    static linearlyInterpolate(amt) {
        return 1.0 * amt
    }

    static quadraticallyInterpolate(amt) {
        return amt * amt
    }

    static exponentiallyInterpolate(amt) {
        return Math.exp(1.0 - 1.0 / (amt * amt))
    }

    static toRtmArray(msg) {
        msg = Midi.cleanMessage(msg)
        let size = Midi.messageSize(msg)
        return [msg.status, msg.data, msg.value].slice(0, size)
    }

    static newRtmDevice(name, out, opts = {}) {
        const type = out ? "Out" : "In"
        let rtmDevice
        if (typeof name === 'string' && opts.virtual) {
            rtmDevice = out && Midi.virtualOutputs[name] ? Midi.virtualOutputs[name].rtmDevice :
                !out && Midi.virtualInputs[name] ? Midi.virtualInputs[name].rtmDevice : null
            if (rtmDevice) {
                console.log(`Found and reusing VIRTUAL ${type} ${name}`)
                return rtmDevice
            }
        }
        if (!!process.argv.find((a) => a == "--j5-debug-midi")) {
            rtmDevice = new RtMidiDeviceProxy(out, opts)
        } else {
            rtmDevice = out ? new midi.Output() : new midi.Input()
        }
        rtmDevice.portIndex = this.findAndOpenPort(rtmDevice, type, name, opts)
        if (!out) {
            rtmDevice.ignoreTypes(false, false, false)
        }

        return rtmDevice
    }

    static findAndOpenPort(rtmDevice, type, name, opts = {}) {
        const pattern =
            name.constructor === RegExp ? name : new RegExp(name, "ig")
        const numPorts = rtmDevice.getPortCount()
        let portNames = []
        for (let i = 0; i < numPorts; i++) {
            portNames.push(rtmDevice.getPortName(i))
        }
        portNames = portNames.filter(n => !n.match(new RegExp(Midi.argv('j5-ignore-device', '___j5!'), "ig")))
        const filter = n => (!opts.exclude && n.match(pattern)) || (opts.exclude && !n.match(pattern))
        let portIndex = portNames.findIndex(n => filter(n))
        if (portIndex >= 0 && opts.second) portIndex = portNames.findIndex((n, i) => i > portIndex && filter(n))
        if (portIndex < 0 || opts.forceNewVirtual) {
            if (opts.virtual) {
                portIndex = portNames.length
                name = Midi.argv('j5-prepend-virtual') ? 'VIRTUAL ' + name : name
                portNames.push(name)
                rtmDevice.openVirtualPort(name)
                Midi[`virtual${type}puts`][name] = { rtmDevice: rtmDevice }
                type = "VIRTUAL " + type
            } else {
                console.error(
                    `Could not find Midi (${type}) for: "${name}" of ${portNames}`
                )
                rtmDevice.closePort()
                return -1
            }
        } else {
            rtmDevice.openPort(portIndex)
        }
        rtmDevice.name = portNames[portIndex]
        console.log(`Opened Midi ${type} port: ${rtmDevice.name}        (All: ${portNames})`)
        return portIndex
    }

    static cleanMessage(msg) {
        if (!msg.channel) {
            msg.channel = 0
        }
        msg.channel = parseInt(msg.channel) || 0
        if (!msg.type) {
            if (!Midi.isEmpty(msg.cc)) {
                msg.type = Midi.Types.CC
                msg.data = msg.cc
            } else if (!Midi.isEmpty(msg.program)) {
                msg.type = Midi.Types.PROGRAM
                msg.data = msg.program
            } else if (!Midi.isEmpty(msg.note)) {
                msg.data = msg.note
                msg.type = !msg.value ? Midi.Types.NOTE_OFF : Midi.Types.NOTE_ON
            } else {
                throw new Error("Cant convert midi " + JSON.stringify(msg))
            }
        }
        // handle if 0 velocity should be note off
        if (msg.type === Midi.Types.NOTE_ON && msg.value === 0) {
            msg.type = Midi.Types.NOTE_OFF
            msg.status = msg.type + msg.channel
        }
        if (!msg.status) {
            msg.status = msg.type + msg.channel
        }
        Midi.setChannel(msg, msg.channel)
        return msg
    }

    static messageSize(msg) {
        let size = -1
        if (msg.type <= Midi.Types.PITCH_BEND) {
            if (Midi.isProgram(msg) || Midi.isChannelAfterTouch(msg)) {
                size = 2
            } else {
                size = 3
            }
        } else {
            // todo jmarnell, figure out what this was doing and make clear
            if (msg.status == 242) {
                size = 3
            } else {
                size = 1
            }
        }
        return size
    }

    static nanos(hrtimeDelta) {
        return hrtimeDelta[0] * NANO_PER_SEC + hrtimeDelta[1]
    }

    // todo: uhhhhhhhhh, make this better
    static clone(object) {
        return JSON.parse(JSON.stringify(object))
    }
}

Midi.NANO_PER_SEC = NANO_PER_SEC
Midi.SEC_PER_NANO = SEC_PER_NANO

Midi.virtualInputs = {}
Midi.virtualOutputs = {}

Midi.bootTimeMs = Midi.nowMs()
Midi.bootTime = process.hrtime()
Midi.globalTotalTime = 0
console.error(`Booted j5 MIDI, hrtime / nanos reference point: [`, Midi.bootTime[0],
    Midi.bootTime[1], `], "now" secs from then: ${Midi.secsStr(null, 9)
    }, reference point system clock millis: ${Midi.bootTimeMs
    }`, new Date(Midi.bootTimeMs))

Midi.PerformTypes = Object.freeze({
    NOTE_ON: 0b10010000, // 144 , 0x90
    NOTE_OFF: 0b10000000, // 128 , 0x80
    KEY_AFTER: 0b10100000, // 160 , 0xA0
    CHANNEL_AFTER: 0b11010000, // 208 , OxD0
    PITCH_BEND: 0b11100000, // 224 , OxE0
})
Midi.PerformTypesRev = reverse(Midi.PerformTypes)

Midi.Types = Object.freeze(Object.assign({}, Midi.PerformTypes, {
    CC: 0b10110000, // 176 , 0xB0
    SYSEX_START: 0xF0,
    SYSEX_END: 0xF7,

    TYPE_MASK: 0b11110000,
    CHANNEL_MASK: 0b00001111,

    NOTES: NOTES,
    NOTES_SHARPS: NOTES_SHARPS,
    LETTERS_TO_NOTES: LETTERS_TO_NOTES,
    LETTERS_TO_NOTES_SHARPS: LETTERS_TO_NOTES_SHARPS,
}))

Midi.TypeNames = Object.freeze({
    [Midi.Types.NOTE_ON]: "noteon",
    [Midi.Types.NOTE_OFF]: "noteoff",
    [Midi.Types.CC]: "cc",
    [Midi.Types.PROGRAM]: "program",
    [Midi.Types.KEY_AFTER]: "keyafter",
    [Midi.Types.CHANNEL_AFTER]: "channelafter",
    [Midi.Types.PITCH_BEND]: "pitchbend",
})

Midi.Drum = Object.freeze({
    KICK: 36,
    CLICK: 37,
    SNARE: 38,
    CLAP: 39,
    HIHAT: 42,
    TOM_HIGH: 43,
    HIHAT_OPEN: 46,
    CRASH: 55, // 49, ?
    RIDE: 51,
    CHINA: 52,
    RIDE_BELL: 53,
    TAMBOURINE: 54,
    SPLASH: 50, //55, ?
    COWBELL: 56,
    I_GOTTA_FEEVAH: 56,
    CRASH_2: 57,
})

Midi.CC_PERFORM = Object.freeze({
    MOD_WHEEL: 1,
    BREATH_CONTROLLER: 2,
    FOOT_CONTROLLER: 4,
    PORTAMENTO_TIME: 5,
    EXPRESSION_CONTROLLER: 11,
    EFFECT_CONTROL_1: 12,
    EFFECT_CONTROL_2: 13,
    LSB_MOD_WHEEL: 33,
    LSB_BREATH_CONTROLLER: 34,
    LSB_FOOT_CONTROLLER: 36,
    LSB_PORTAMENTO_TIME: 37,
    LSB_EXPRESSION_CONTROLLER: 43,
    LSB_EFFECT_CONTROL_1: 44,
    LSB_EFFECT_CONTROL_2: 45,
    SUSTAIN_PEDAL: 64,
    PORTAMENTO_BYPASS: 65,
    SOSTENUTO_BYPASS: 66,
    SOFT_PEDAL_BYPASS: 67,
    LEGATO_FOOT_BYPASS: 68,
})
Midi.CC_PERFORM_REV = reverse(Midi.CC_PERFORM)

Midi.CC = Object.freeze(Object.assign({}, Midi.CC_PERFORM, {
    VOLUME: 7,
}))

module.exports = Object.freeze(Midi)
