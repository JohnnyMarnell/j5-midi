const midi = require('midi')
const RtMidiDeviceProxy = require('./RtMidiDeviceProxy')

const NOTES =        'C Db D Eb E F Gb G Ab A Bb B'.split(' ')
const NOTES_SHARPS = 'C C# D D# E F F# G G# A A# B'.split(' ')
const LETTERS_TO_NOTES = {}
const LETTERS_TO_NOTES_SHARPS = {}
NOTES.forEach((letter, index) => LETTERS_TO_NOTES[letter] = index)
NOTES_SHARPS.forEach((letter, index) => LETTERS_TO_NOTES_SHARPS[letter] = index)

class Midi {
    static newRtmDevice(name, out, opts) {
        const type = out ? 'Out' : 'In'
        const pattern = name.constructor == RegExp ? name : new RegExp(name, "ig")
        const debug = !!process.argv.find(a => a == '--debug-midi')
        const rtmDevice = debug ? new RtMidiDeviceProxy(out, opts) : out ? new midi.Output() : new midi.Input()
        const numPorts = rtmDevice.getPortCount()
        const portNames = []
        for (let i = 0; i < numPorts; i++) {
            portNames.push(rtmDevice.getPortName(i))
        }
        const portIndex = portNames.findIndex(n => n.match(pattern))
        if (portIndex <= 0) {
            console.error(`Could not find (${type}) for: "${name}" of ${portNames}`)
            rtmDevice.closePort()
            return null
        }
        rtmDevice.name = portNames[portIndex]
        console.log(`Opening Midi${type} port: ${rtmDevice.name}`)
        rtmDevice.openPort(portIndex)
        return rtmDevice
    }
    static isEmpty(val) {
        return !val && val !== 0 && val !== false
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
            }
            else if (!Midi.isEmpty(msg.program)) {
                msg.type = Midi.Types.PROGRAM
                msg.data = msg.program
            } 
            else if (!Midi.isEmpty(msg.note)) {
                msg.data = msg.note
                msg.type = !msg.value ? Midi.Types.NOTE_OFF : Midi.Types.NOTE_ON
            }
            else {
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
            size = msg.type == Midi.Types.PROGRAM || msg.type == Midi.Types.CHANNEL_AFTER ? 2 : 3
        } else { // todo jmarnell, figure out what this was doing and make clear
            size = msg.status == 241 || msg.status == 243 ? 1 : msg.status == 242 ? 3 : 1
        }
        return size
    }
    static translateFromRtMessage(dt, data) {        
        let msg = {
            status: data[0],
            type: data[0] & Midi.Types.TYPE_MASK,
            channel: data[0] & Midi.Types.CHANNEL_MASK,
            data: data[1],
            value: data[2],
            dt: dt
        }
        return msg
    }
    static relativizeNote(msg) {
        let note = (Midi.isEmpty(msg.data) ? msg : msg.data)
        note = (note + 12) % 12
        // console.log('rel', note, JSON.stringify(msg))
        return note
    }
    static noteLetter(msg) {
        return Midi.Types.NOTES[Midi.relativizeNote(msg)]
    }
    static noteNumberFromString(str) {
        let re = /(.*?)(\d+)?$/
        let letter = str.replace(re, "$1")
        let octave = parseInt(str.replace(re, "$2")) || 0
        let noteNumber = Midi.Types.LETTERS_TO_NOTES[letter]
            ||  Midi.Types.LETTERS_TO_NOTES_SHARPS[letter]
        noteNumber += octave * 12
        console.log('note translaishe:', noteNumber, letter, octave, str)
        return noteNumber
    }
    static byteNote(note) {
        note = ('' + note).toUpperCase()
        let octave = parseInt(note.substring(1))
        // todo jmarnell: cant remember
    }
    static sig(msg) {
        return [ msg.type, msg.channel, msg.data ].join('|')
    }
    static now() {
        return new Date().getTime()
    }
    static isNote(msg) {
        return msg.type == Midi.Types.NOTE_ON || msg.type == Midi.Types.NOTE_OFF
    }
    static isNoteOn(msg, note) {
        return msg.type == Midi.Types.NOTE_ON
            && (Midi.isEmpty(note) || msg.data == note)
    }
    static isNoteOff(msg, note) {
        return msg.type == Midi.Types.NOTE_OFF
            && (Midi.isEmpty(note) || msg.data == note)
    }
    static isCC(msg) {
        return msg.type == Midi.Types.CC
    }
    static on(target, msg) { // match a noteOn or a cc press (high)
        return (Midi.isNote(target) && Midi.isNoteOn(msg) || Midi.isCC(target) && msg.value > 64)
            && (Midi.isEmpty(target.data) || target.data == msg.data)
            && (Midi.isEmpty(target.channel) || target.channel == msg.channel)
    }
    static off(target, msg) { // match a noteOff or a cc release (low)
        return (Midi.isNote(target) && Midi.isNoteOff(msg) || Midi.isCC(target) && msg.value < 64)
            && (Midi.isEmpty(target.data) || target.data == msg.data)
            && (Midi.isEmpty(target.channel) || target.channel == msg.channel)
    }
    static when(target, msg) {
        return (!target.type || target.type == msg.type)
            && (Midi.isEmpty(target.data) || target.data == msg.data)
            && (Midi.isEmpty(target.channel) || target.channel == msg.channel)
            && (Midi.isEmpty(target.value) || target.value == msg.value)
    }
    static fuzzy(target, msg) {
        return target.data == msg.data
            && target.channel == msg.channel
            && (target.type == msg.type || Midi.isNote(target) && Midi.isNote(msg))
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
            console.error("ERROR: Don't know how to convert", Midi.desc(source), 'to', Midi.desc(target))
        }
        return target
    }
    static ccDown(msg, data) {
        return msg.type == Midi.Types.CC && msg.data == data && msg.value > 63
    }
    static ccKnob(msg, data, channel) {
        return msg.type == Midi.Types.CC
            && (Midi.isEmpty(data) || msg.data == data)
            && (Midi.isEmpty(channel) || msg.channel == channel)
    }
    static note(noteNum, channel, off, velocity) {
        return {
            type: !!off ? Midi.Types.NOTE_OFF : Midi.Types.NOTE_ON,
            data: noteNum,
            value: !!off ? 0 : velocity || 127,
            channel: channel || 0
        }
    }
    static cc(data, channel, value) {
        return {
            type: Midi.Types.CC,
            data: data,
            channel: channel || 0,
            value: value
        }
    }
    static program(program, channel) {
        return {
            type: Midi.Types.PROGRAM,
            data: program,
            channel: channel || 0
        }
    }
    static type(msg) {
        return msg.type == Midi.Types.CC ? 'cc' :
            msg.type == Midi.Types.NOTE_ON ? 'noteon' : 
            msg.type == Midi.Types.NOTE_OFF ? 'noteoff' : 
            msg.type == Midi.Types.PROGRAM ? 'program' : 
            msg.type == Midi.Types.KEY_AFTER ? 'keyafter' : 
            msg.type == Midi.Types.CHANNEL_AFTER ? 'channelafter' : 
            msg.type == Midi.Types.PITCH_BEND ? 'pitchbend' : 'unknown'
    }
    static parse(str) {
        str = str.toString().split(' ')
        let type = str[0]
        return (type == 'cc') ? Midi.cc(parseInt(str[2]), parseInt(str[1]), parseInt(str[3])) :
            (type == 'program') ? { type: Midi.Types.PROGRAM, data: parseInt(str[2]), channel: parseInt(str[1]) } :
            Midi.note(parseInt(str[2]), parseInt(str[1]), 'noteoff' == str[0].toLowerCase(), parseInt(str[3]))
    }
    static desc(msg) {
        return [ Midi.type(msg), msg.channel, msg.data, msg.value ].join(' ')
    }
    static short(msg) {
        return [ Midi.isNote(msg) ? 'note' : Midi.type(msg), msg.channel, msg.data ].join(' ')
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
            Object.keys(Midi.Types).find(key => Midi.Types[key] == msg.type),
            Midi.isNote(msg) ? Midi.noteLetter(msg) : msg.data,
            msg.value
        ).join(' ')
    }
    static intitializeMidiEvent(msg, startTime, totalTime, name) {
        msg.time = Midi.now()
        msg.totalTime = (msg.time - startTime) / 1000
        msg.dt = msg.totalTime - totalTime
        msg.input = name
        msg.originalChannel = msg.channel
        msg.originalData = msg.data
        let hrtime = process.hrtime()
        msg.id = hrtime[0] + '.' + hrtime[1]
    }
    static globalInitializeMidiEvent(msg) {
        Midi.intitializeMidiEvent(msg, Midi.bootTime, Midi.globalTotalTime, 'global-simulated-timing')
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
        return Math.exp(1.0 - (1.0 / (amt * amt)))
    }
    static hasPortBeenEnumerated(pattern) {
        return !!Object.values(allKnownPorts).filter(p => p.name.match(pattern)).length
    }
    static toRtmArray(msg) {
        msg = Midi.cleanMessage(msg)
        let size = Midi.messageSize(msg)
        let rtmArray = 
            size == 3 ? [msg.status, msg.data, msg.value] :
            size == 2 ? [msg.status, msg.data] : [msg.status]
        return rtmArray
    }
}
Midi.bootTime = Midi.now()
Midi.globalTotalTime = 0
Midi.Types = Object.freeze({
    NOTE_ON : 		parseInt("10010000", 2),
    NOTE_OFF :		parseInt("10000000", 2),
    CC :    		parseInt("10110000", 2),
    PROGRAM :       parseInt("11000000", 2),
    KEY_AFTER :     parseInt("10100000", 2),
    CHANNEL_AFTER : parseInt("11010000", 2),
    PITCH_BEND :    parseInt("11100000", 2),

    TYPE_MASK : 	parseInt("11110000", 2),
    CHANNEL_MASK : 	parseInt("00001111", 2),

    NOTES: NOTES,
    NOTES_SHARPS: NOTES_SHARPS,
    LETTERS_TO_NOTES: LETTERS_TO_NOTES,
    LETTERS_TO_NOTES_SHARPS: LETTERS_TO_NOTES_SHARPS,
})
Midi.Drum = Object.freeze({
    KICK: 36, SNARE: 38, HIHAT: 42, HIHAT_OPEN: 46,
})

module.exports = Midi