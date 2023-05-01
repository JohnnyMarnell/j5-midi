const midi = require("@julusian/midi")

const DEBUG_CALLS = !!process.argv.find((a) => a == "--debug-midi-calls")

class RtMidiDeviceProxy {
    constructor(isOutput, opts) {
        RtMidiDeviceProxy.devices = (RtMidiDeviceProxy.devices || 0) + 1
        this.realDevice = isOutput ? new midi.Output() : new midi.Input()
        this.type = isOutput ? "Out" : "In"
        this.deviceNumber = RtMidiDeviceProxy.devices
        this.proxyMethod("openPort")
        this.proxyMethod("closePort")
        this.proxyMethod("getPortCount")
        this.proxyMethod("getPortName")
        this.proxyMethod("sendMessage")
        this.proxyMethod("on")
        this.proxyMethod("ignoreTypes")
        this.proxyMethod("openVirtualPort")
        if (!isOutput) {
            this.on("message", (dt, data) => {
                console.log(
                    `\nRtMidi: (${this.displayName()}) received (${dt} ; ${data})`
                )
            })
        }
    }

    displayName() {
        const name = this.name || "Not_Yet_Named"
        return `Rtm${this.type} ${this.deviceNumber}: ${name}`
    }

    proxyMethod(name) {
        this[name] = function () {
            const args = JSON.stringify(arguments)
            console.log(
                `\nRtMidi: calling ${name} on (${this.displayName()}) with ${args}`
            )
            const result = this.realDevice[name].apply(
                this.realDevice,
                arguments
            )
            console.log(
                `RtMidi: returning ${result} for ${name} on ${this.tag} with ${args}`
            )
            if (DEBUG_CALLS) {
                console.log(new Error().stack)
            }
            return result
        }
    }
}
module.exports = RtMidiDeviceProxy
