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

class Midi {

    static ccDown(msg, data) {
        return msg.type == Midi.Types.CC && msg.data == data && msg.value > 63
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
        let msg = {
            status: data[0],
            type: data[0] & Midi.Types.TYPE_MASK,
            channel: data[0] & Midi.Types.CHANNEL_MASK,
            data: data[1],
            value: data[2],
            dt: dt,
        }
        return msg
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
        console.log("note translaishe:", noteNumber, letter, octave, str)
        return noteNumber
    }

    static sig(msg) {
        return [msg.type, msg.channel, msg.data].join("|")
    }

    static now() {
        return new Date().getTime()
    }

    static isNote(msg) {
        return msg.type == Midi.Types.NOTE_ON || msg.type == Midi.Types.NOTE_OFF
    }

    static isNoteOn(msg, note) {
        return (
            msg.type == Midi.Types.NOTE_ON &&
            (Midi.isEmpty(note) || msg.data == note)
        )
    }

    static isNoteOff(msg, note) {
        return (
            msg.type == Midi.Types.NOTE_OFF &&
            (Midi.isEmpty(note) || msg.data == note)
        )
    }

    static isCC(msg) {
        return msg.type == Midi.Types.CC
    }

    static isProgram(msg) {
        return msg.type == Midi.Types.PROGRAM
    }

    static isChannelAfterTouch(msg) {
        return msg.type == Midi.Types.CHANNEL_AFTER
    }

    static isSysEx(rtmData) {
        return rtmData[0] == Midi.Types.SYSEX_START && rtmData[rtmData.length - 1] == Midi.Types.SYSEX_END
    }

    // match a noteOn or a cc press (high)
    static on(target, msg) {
        return (
            ((Midi.isNote(target) && Midi.isNoteOn(msg)) ||
                (Midi.isCC(target) && msg.value > 64)) &&
            (Midi.isEmpty(target.data) || target.data == msg.data) &&
            (Midi.isEmpty(target.channel) || target.channel == msg.channel)
        )
    }

    // match a noteOff or a cc release (low)
    static off(target, msg) {
        return (
            ((Midi.isNote(target) && Midi.isNoteOff(msg)) ||
                (Midi.isCC(target) && msg.value < 64)) &&
            (Midi.isEmpty(target.data) || target.data == msg.data) &&
            (Midi.isEmpty(target.channel) || target.channel == msg.channel)
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
        if (type == Midi.TypeNames.CC) {
            msg = Midi.cc(val2, val1, val3)
        } else if (type == Midi.TypeNames.PROGRAM) {
            msg = Midi.program(val2, val1)
        } else {
            const off = Midi.TypeNames.NOTE_OFF == type.toLowerCase()
            msg = Midi.note(val2, val1, off, val3)
        }
        return msg
    }

    static desc(msg) {
        return [Midi.type(msg), msg.channel, msg.data, msg.value].join(" ")
    }

    static short(msg) {
        return [
            Midi.isNote(msg) ? "note" : Midi.type(msg),
            msg.channel,
            msg.data,
        ].join(" ")
    }

    static fluidCommand(msg) {
        return `${this.type(msg)} ${msg.channel} ${msg.data} ${msg.value}\n`
    }

    static setChannel(msg, channel) {
        msg.channel = channel
        msg.status = msg.type + channel
    }

    static messageText(msg) {
        return Array(
            Object.keys(Midi.Types).find((key) => Midi.Types[key] == msg.type),
            Midi.isNote(msg) ? Midi.noteLetter(msg) : msg.data,
            msg.value
        ).join(" ")
    }

    static intitializeMidiEvent(msg, startTime, totalTime, name) {
        msg.time = Midi.now()
        msg.totalTime = (msg.time - startTime) / 1000
        msg.dt = msg.totalTime - totalTime
        msg.input = name
        msg.originalChannel = msg.channel
        msg.originalData = msg.data
        let hrtime = process.hrtime()
        msg.id = hrtime[0] + "." + hrtime[1]
    }

    static globalInitializeMidiEvent(msg) {
        Midi.intitializeMidiEvent(
            msg,
            Midi.bootTime,
            Midi.globalTotalTime,
            "global-simulated-timing"
        )
        Midi.globalTotalTime = msg.totalTime
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

    static newRtmDevice(name, out, opts) {
        const type = out ? "Out" : "In"
        let rtmDevice
        if (!!process.argv.find((a) => a == "--debug-midi")) {
            rtmDevice = new RtMidiDeviceProxy(out, opts)
        } else {
            rtmDevice = out ? new midi.Output() : new midi.Input()
        }
        if (opts.virtual) {
            rtmDevice.openVirtualPort(name)
            rtmDevice.name = name
            console.log(`Opened Virtual Midi ${type} port: ${rtmDevice.name}`)
        } else {
            this.findAndOpenPort(rtmDevice, type, name)
        }
        if (!out) {
            rtmDevice.ignoreTypes(false, false, false)
        }

        return rtmDevice
    }

    static findAndOpenPort(rtmDevice, type, name) {
        const pattern =
            name.constructor == RegExp ? name : new RegExp(name, "ig")
        const numPorts = rtmDevice.getPortCount()
        const portNames = []
        for (let i = 0; i < numPorts; i++) {
            portNames.push(rtmDevice.getPortName(i))
        }
        const portIndex = portNames.findIndex((n) => n.match(pattern))
        if (portIndex <= 0) {
            console.error(
                `Could not find Midi (${type}) for: "${name}" of ${portNames}`
            )
            rtmDevice.closePort()
            return null
        }
        rtmDevice.name = portNames[portIndex]
        rtmDevice.openPort(portIndex)
        console.log(`Opened Midi ${type} port: ${rtmDevice.name}        (All: ${portNames})`)
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
        if (msg.type == Midi.Types.NOTE_ON && msg.value == 0) {
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
}

Midi.bootTime = Midi.now()
Midi.globalTotalTime = 0

Midi.Types = Object.freeze({
    NOTE_ON: 0b10010000,
    NOTE_OFF: 0b10000000,
    CC: 0b10110000,
    PROGRAM: 0b11000000,
    KEY_AFTER: 0b10100000,
    CHANNEL_AFTER: 0b11010000,
    PITCH_BEND: 0b11100000,
    SYSEX_START: 0xF0,
    SYSEX_END: 0xF7,

    TYPE_MASK: 0b11110000,
    CHANNEL_MASK: 0b00001111,

    NOTES: NOTES,
    NOTES_SHARPS: NOTES_SHARPS,
    LETTERS_TO_NOTES: LETTERS_TO_NOTES,
    LETTERS_TO_NOTES_SHARPS: LETTERS_TO_NOTES_SHARPS,
})

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
    SNARE: 38,
    HIHAT: 42,
    HIHAT_OPEN: 46,
})

module.exports = Midi
