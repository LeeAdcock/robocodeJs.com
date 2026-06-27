// Smoke test for the isolated-vm API surface used by src/util/compiler.ts.
//
// Run after changing the Node or isolated-vm version (e.g. `npm run smoke`) to
// confirm the native module builds/loads and the API patterns compiler.ts
// relies on still work. The ivm module is never exposed to the isolate; all
// Callback/Reference/ExternalCopy objects are built host-side. Patterns checked:
//   1. ExternalCopy round-trip (synchronous getters)
//   2. async-call bridge: a parked promise settled via a captured __settle
//      reference, object result copied back with copyInto()
//   3. event dispatch via a captured __dispatch reference + async apply, with
//      host resolve/reject passed as arguments (they auto-wrap)
//   4. async apply honoring a timeout to interrupt a runaway loop (off-thread)
const ivm = require('isolated-vm');
const { version } = require('isolated-vm/package.json');

async function main() {
  let catastrophic = false;
  const isolate = new ivm.Isolate({
    memoryLimit: 8,
    onCatastrophicError: () => {
      catastrophic = true;
    },
  });
  const context = isolate.createContextSync();
  isolate
    .compileScriptSync('var bot = { radar: {}, turret: {} }')
    .runSync(context, {});

  // 1) ExternalCopy round-trip (e.g. bot.getX = () => _bot_getX().copy())
  context.global.setSync('_bot_getX', () => new ivm.ExternalCopy(42));
  isolate
    .compileScriptSync('bot.getX = () => _bot_getX().copy()')
    .runSync(context, {});
  const x = isolate
    .compileScriptSync('bot.getX()')
    .runSync(context, { copy: true });
  if (x !== 42) throw new Error(`ExternalCopy round-trip failed: got ${x}`);

  // 2) async-call bridge (e.g. bot.radar.scan): native parks the promise, host
  //    settles it via the captured __settle reference; object result copied back.
  isolate
    .compileScriptSync(
      `
      let __seq = 0
      const __pending = {}
      const __asyncCall = (fn, ...a) => new Promise((res, rej) => {
        const id = ++__seq; __pending[id] = { res, rej }; fn(id, ...a)
      })
      globalThis.__settle = (id, ok, v) => {
        const p = __pending[id]; if (!p) return; delete __pending[id]
        ok ? p.res(v) : p.rej(v)
      }
      bot.scan = () => __asyncCall(_bot_scan)
      `
    )
    .runSync(context, {});
  const settleRef = context.evalSync('__settle', { reference: true });
  context.global.setSync('_bot_scan', (id) => {
    Promise.resolve([{ id: 'a' }]).then((v) =>
      settleRef.apply(
        undefined,
        [id, true, new ivm.ExternalCopy(v).copyInto()],
        { timeout: 5000 }
      )
    );
  });
  const hits = await isolate
    .compileScriptSync('bot.scan()')
    .runSync(context, { copy: true, promise: true });
  if (!Array.isArray(hits) || hits[0].id !== 'a')
    throw new Error(`async result copy failed: ${JSON.stringify(hits)}`);

  // 3) event dispatch via a captured reference + async apply (the bot.on bridge)
  let captured = null;
  isolate
    .compileScriptSync(
      `
      const __handlers = {}
      bot.on = (e, fn) => { __handlers[e] = fn; _register(e) }
      globalThis.__dispatch = (e, jsonArgs, resolve, reject) => {
        const fn = __handlers[e]; if (!fn) { resolve(); return }
        return (fn.apply(undefined, JSON.parse(jsonArgs)) || Promise.resolve()).then(resolve, reject)
      }
      `
    )
    .runSync(context, {});
  const dispatchRef = context.evalSync('__dispatch', { reference: true });
  context.global.setSync('_register', () => {});
  context.global.setSync('_capture', (v) => {
    captured = v;
  });
  isolate
    .compileScriptSync(`bot.on('START', (x) => { _capture(x) })`)
    .runSync(context, {});
  await dispatchRef.apply(
    undefined,
    ['START', JSON.stringify(['hello']), () => {}, () => {}],
    { timeout: 5000 }
  );
  if (captured !== 'hello')
    throw new Error(`event dispatch failed: got ${captured}`);

  // 4) async apply honors a timeout, interrupting a runaway loop off-thread
  isolate
    .compileScriptSync('globalThis.__loop = () => { while (true) {} }')
    .runSync(context, {});
  const loopRef = context.evalSync('__loop', { reference: true });
  let timedOut = false;
  try {
    await loopRef.apply(undefined, [], { timeout: 200 });
  } catch {
    timedOut = true;
  }
  if (!timedOut) throw new Error('apply timeout did not fire');

  context.release();
  isolate.dispose();
  if (catastrophic) throw new Error('catastrophic error flagged');

  console.log(`OK isolated-vm ${version} api smoke passed`);
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
