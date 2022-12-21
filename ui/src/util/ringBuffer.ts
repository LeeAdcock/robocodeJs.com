/*
  This is a circular buffer used to capture and present log information.
*/

export default class RingBuffer {
    buffer: (undefined | object)[]
    recordIndex = 0

    constructor(size = 1000) {
        this.buffer = new Array(size)
    }

    // Write a log record into the ring buffer
    write = (value) => {
        const record = Object.assign(value, { id: this.recordIndex++ })
        this.buffer[this.recordIndex % this.buffer.length] = record
    }

    // Get all records in the buffer (this is a direct reference)
    getRecords = () => this.buffer

    // Get the last record in the buffer
    getLastRecord = () =>
        this.buffer[(this.recordIndex - 1) % this.buffer.length]

    // Clear the buffer
    clear = () => this.buffer.fill(undefined)
}
