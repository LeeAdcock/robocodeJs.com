import Arena from '../types/arena'
import Process from '../types/process'
import Tank from '../types/tank'
import { Event } from '../types/event'
import { createConsoleWrapper } from './wrappers/consoleWrapper'
import { createTankWrapper } from './wrappers/tankWrapper'
import ivm from 'isolated-vm';

/*
  The compiler is reponsible for executing the user-provided code. This is done by
  exposing objects or wrapped "monkey-patched" versions of objects to create a new
  Function instance, and then executing that function.
*/

export default {
  // Initialize a tank with its application logic, compiles the app source code
  // within a sandboxed environment.
  compile: (
    arena: Arena,
    process: Process,
    tank: Tank
  ) => {

    const app = process.app

    // Custom console logger visible to the applicaton
    const consoleWrapper = createConsoleWrapper(arena, app, tank)


    // Tank object visible to the applicaton
    const tankWrapper = createTankWrapper(arena, process, tank, consoleWrapper)



    // Build and execute the tank logic in a sandboxed environment
    try {
      tank.handlers = {}

      // todo reuse across tanks
      const isolate = new ivm.Isolate({ memoryLimit: 8 });
      const untrustedScript = isolate.compileScriptSync(app.source)

      const context = isolate.createContextSync();
      context.global.setSync('_ivm', ivm)

      context.global.setSync("_on", (event: Event, handler: ivm.Callback) => {
        tankWrapper.on(event, handler)
      })

      context.global.setSync("_setSpeed", (arg: number, resolve: Function, reject: Function) => 
        tankWrapper.setSpeed(arg).then(
          (value) => { console.log("resolve"); resolve(new ivm.ExternalCopy(value).copyInto()) },           
        ).catch(
          (reason) => { console.log("reject"); reject(new ivm.ExternalCopy(reason).copyInto() ) }
        )
      )

      context.global.setSync("_setOrientation", (arg: number) => tankWrapper.setOrientation(arg))

      context.global.setSync('log', function(...args) {
        console.log(...args);
      });  

      const initScript = isolate.compileScriptSync(`
        const bot={
          setSpeed: speed => new Promise((resolve, reject) => _setSpeed(speed, new _ivm.Callback(resolve), new _ivm.Callback(reject))),
          setOrientation: orientation => _setOrientation(orientation),
        
          on: (evt, fn) => _on(evt, new _ivm.Callback(fn))
        }
      `)
      initScript.runSync(context, {})
      untrustedScript.runIgnored(context, {})

    } catch (e) {
      consoleWrapper.error(e)
      console.log(e)
    }
  },
}
