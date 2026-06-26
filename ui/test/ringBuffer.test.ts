import { describe, it, expect } from 'vitest'
import RingBuffer from '../src/util/ringBuffer'

// Characterization tests: these capture the CURRENT behavior of RingBuffer so a
// later refactor makes any behavior change explicit (a failing test diff).
// Two current behaviors are buggy and called out below; when they're fixed,
// these expectations should be updated deliberately.

const defined = (buf: RingBuffer) => buf.getRecords().filter((r) => r)

describe('RingBuffer', () => {
    it('allocates a buffer of the requested size, initially empty', () => {
        const buf = new RingBuffer(5)
        expect(buf.getRecords()).toHaveLength(5)
        expect(defined(buf)).toHaveLength(0)
    })

    it('assigns incrementing ids starting at 0 and mutates the written object', () => {
        const buf = new RingBuffer(10)
        const a = { msg: 'a' }
        const b = { msg: 'b' }
        buf.write(a)
        buf.write(b)
        // write() mutates the passed object, adding an id
        expect(a).toHaveProperty('id', 0)
        expect(b).toHaveProperty('id', 1)
    })

    it('retains written records until capacity is exceeded', () => {
        const buf = new RingBuffer(10)
        buf.write({ msg: 'a' })
        buf.write({ msg: 'b' })
        buf.write({ msg: 'c' })
        const ids = defined(buf)
            .map((r) => (r as { id: number }).id)
            .sort((x, y) => x - y)
        expect(ids).toEqual([0, 1, 2])
    })

    it('wraps around and keeps the most recent `size` records', () => {
        const buf = new RingBuffer(3)
        for (let i = 0; i < 4; i++) buf.write({ n: i })
        const ids = defined(buf)
            .map((r) => (r as { id: number }).id)
            .sort((x, y) => x - y)
        // 4 writes into a size-3 buffer: the oldest (id 0) is overwritten.
        expect(ids).toEqual([1, 2, 3])
    })

    it('clear() empties the buffer', () => {
        const buf = new RingBuffer(3)
        buf.write({ msg: 'a' })
        buf.clear()
        expect(defined(buf)).toHaveLength(0)
    })

    // KNOWN BUG (refactor backlog): getLastRecord is off-by-one. Because write()
    // increments recordIndex *before* storing, the first write lands at index 1
    // and getLastRecord reads index (recordIndex-1), i.e. the slot *before* the
    // most recent write. So after a single write it returns undefined, and after
    // N writes it returns the second-to-most-recent record.
    it('getLastRecord currently returns undefined after a single write (off-by-one bug)', () => {
        const buf = new RingBuffer(10)
        buf.write({ msg: 'only' })
        expect(buf.getLastRecord()).toBeUndefined()
    })

    it('getLastRecord currently lags one behind the most recent write (off-by-one bug)', () => {
        const buf = new RingBuffer(10)
        buf.write({ msg: 'first' })
        buf.write({ msg: 'second' })
        // Should be 'second'; current behavior returns 'first'.
        expect((buf.getLastRecord() as { msg: string }).msg).toBe('first')
    })
})
