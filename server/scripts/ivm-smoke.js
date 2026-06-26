// Smoke test for the isolated-vm API surface used by src/util/compiler.ts.
//
// Run after changing the Node or isolated-vm version (e.g. `npm run smoke`) to
// confirm the native module builds/loads and the API patterns compiler.ts
// relies on still work: ExternalCopy round-trips, Callback-based async bridges,
// and Reference + applySync with a timeout.
const ivm = require('isolated-vm')
const { version } = require('isolated-vm/package.json')

async function main() {
    let catastrophic = false
    const isolate = new ivm.Isolate({
        memoryLimit: 8,
        onCatastrophicError: () => {
            catastrophic = true
        },
    })

    const context = isolate.createContextSync()
    context.global.setSync('_ivm', ivm)
    isolate
        .compileScriptSync('var bot = { radar: {}, turret: {} }')
        .runSync(context, {})

    // ExternalCopy round-trip (e.g. bot.getX = () => _bot_getX().copy())
    context.global.setSync('_bot_getX', () => new ivm.ExternalCopy(42))
    isolate
        .compileScriptSync('bot.getX = () => _bot_getX().copy()')
        .runSync(context, {})
    const x = isolate
        .compileScriptSync('bot.getX()')
        .runSync(context, { copy: true })
    if (x !== 42) throw new Error(`ExternalCopy round-trip failed: got ${x}`)

    // Callback-based async (e.g. bot.setSpeed via _ivm.Callback resolve/reject)
    context.global.setSync('_bot_setSpeed', (arg, resolve) => {
        Promise.resolve(arg * 2).then(resolve)
    })
    isolate
        .compileScriptSync(
            `bot.setSpeed = speed => new Promise((resolve, reject) =>
                _bot_setSpeed(speed, new _ivm.Callback(resolve), new _ivm.Callback(reject)))`
        )
        .runSync(context, {})
    const doubled = await isolate
        .compileScriptSync('bot.setSpeed(21)')
        .runSync(context, { copy: true, promise: true })
    if (doubled !== 42) throw new Error(`Callback async failed: got ${doubled}`)

    // Reference + applySync with timeout (e.g. the bot.on event-handler bridge).
    // The native side invokes the handler Reference; it must not return a Promise
    // across the boundary (compiler.ts consumes the promise natively).
    let handlerResult = null
    context.global.setSync('_bot_on', (event, handler) => {
        handler.applySync(undefined, [JSON.stringify([event])], { timeout: 5000 })
    })
    context.global.setSync('_capture', (v) => {
        handlerResult = v
    })
    isolate
        .compileScriptSync(
            `bot.on = (event, fn) => _bot_on(event, new _ivm.Reference((jsonArgs) => {
                fn.apply(undefined, JSON.parse(jsonArgs))
            }))
            bot.on('START', (e) => { _capture(e) })`
        )
        .runSync(context, {})
    if (handlerResult !== 'START')
        throw new Error(`Reference/applySync failed: got ${handlerResult}`)

    context.release()
    isolate.dispose()
    if (catastrophic) throw new Error('catastrophic error flagged')

    console.log(`OK isolated-vm ${version} api smoke passed`)
}

main().catch((e) => {
    console.error('SMOKE FAILED:', e)
    process.exit(1)
})
