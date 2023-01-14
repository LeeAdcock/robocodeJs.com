import Arena from '../types/arena'
import Process from '../types/process'
import Tank from '../types/tank'
import { Event } from '../types/event'
import { createTimerWrappers } from './wrappers/timerWrapper'
import ivm from 'isolated-vm';
import { createLogger } from 'browser-bunyan'
import { v4 as uuidv4 } from 'uuid';

function exposeTankRadar(tank:Tank, isolate: ivm.Isolate, context: ivm.Context) {
 
  // Expose getOrientation
  context.global.setSync("_bot_radar_getOrientation", () => new ivm.ExternalCopy(tank.turret.radar.getOrientation()) )
  isolate.compileScriptSync(`
    bot.radar.getOrientation = () => _bot_radar_getOrientation().copy()
  `).runSync(context, {})

  // Expose setOrientation
  context.global.setSync("_bot_radar_setOrientation", (arg: number, resolve: () => void, reject: () => void) =>  { tank.turret.radar.setOrientation(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.radar.setOrientation = orientation => new Promise((resolve, reject) => _bot_radar_setOrientation(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(context, {})

  // Expose isTurning
  context.global.setSync("_bot_radar_isTurning", () => new ivm.ExternalCopy(tank.turret.radar.isTurning()) )
  isolate.compileScriptSync(`
    bot.radar.isTurning = () => _bot_radar_isTurning().copy()
  `).runSync(context, {})

  // Expose turn
  context.global.setSync("_bot_radar_turn", (arg: number, resolve: () => void, reject: () => void) =>  { tank.turret.radar.turn(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.radar.turn = orientation => new Promise((resolve, reject) => _bot_radar_turn(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(context, {})
  
  // Expose scan
  // todo promise return value
  context.global.setSync("_bot_radar_scan", (resolve: (result: []) => void, reject: () => void) =>  { tank.turret.radar.scan().then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.radar.scan = () => new Promise((resolve, reject) => _bot_radar_scan(new _ivm.Callback((result) => resolve(result)), new _ivm.Callback(() => reject())))
  `).runSync(context, {})
}

function exposeTankTurret(tank:Tank, isolate: ivm.Isolate, context: ivm.Context) {
 
  // Expose getOrientation
  context.global.setSync("_bot_turret_getOrientation", () => new ivm.ExternalCopy(tank.turret.getOrientation()) )
  isolate.compileScriptSync(`
    bot.turret.getOrientation = () => _bot_turret_getOrientation().copy()
  `).runSync(context, {})

  // Expose setOrientation
  context.global.setSync("_bot_turret_setOrientation", (arg: number, resolve: () => void, reject: () => void) =>  { tank.turret.setOrientation(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.turret.setOrientation = orientation => new Promise((resolve, reject) => _bot_turret_setOrientation(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(context, {})

  // Expose isTurning
  context.global.setSync("_bot_turret_isTurning", () => new ivm.ExternalCopy(tank.turret.isTurning()) )
  isolate.compileScriptSync(`
    bot.turret.isTurning = () => _bot_turret_isTurning().copy()
  `).runSync(context, {})

  // Expose turn
  context.global.setSync("_bot_turret_turn", (arg: number, resolve: () => void, reject: () => void) =>  { tank.turret.turn(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.turret.turn = orientation => new Promise((resolve, reject) => _bot_turret_turn(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(context, {})
  
  // Expose fire
  // todo resulting value
  context.global.setSync("_bot_turret_fire", (resolve: () => void, reject: () => void) =>  { tank.turret.fire().then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.turret.fire = () => new Promise((resolve, reject) => _bot_turret_fire(new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(context, {})
}

function exposeTank(tank:Tank, isolate: ivm.Isolate, context: ivm.Context) {

  // Expose event handler
  context.global.setSync("_bot_on", (event: Event, handler: ivm.Reference) => {
    tank.on(event, (...args) => {
      if (!Object.keys(Event).includes(event)) throw new Error('Invalid event type.')

      try {
        return new Promise((resolve, reject) => {
          handler.applySync(undefined, [resolve, reject, JSON.stringify(args)], {timeout:5000})
        })
      } catch (e) {
        // todo kill tank?
        console.log(e)
      }
    })
  })
  isolate.compileScriptSync(`
    bot.scope = {}
    bot.on = (event, handler) => _bot_on(event, new _ivm.Reference((resolve, reject, jsonArgs) => { 
      returnValue = handler.apply(bot.scope, JSON.parse(jsonArgs))
      return (returnValue || Promse.resolve()).then(resolve, reject)
    }))
  `).runSync(context, {})

  // Expose getId
  context.global.setSync("_bot_getId", () => new ivm.ExternalCopy(tank.getId()) )
  isolate.compileScriptSync(`
    bot.getId = () => _bot_getId().copy()
  `).runSync(context, {})

  // Expose getSpeed
  context.global.setSync("_bot_getSpeed", () => new ivm.ExternalCopy(tank.getSpeed()) )
  isolate.compileScriptSync(`
    bot.getSpeed = () => _bot_getSpeed().copy()
  `).runSync(context, {})
        
  // Expose setSpeed
  context.global.setSync("_bot_setSpeed", (arg: number, resolve: () => void, reject: () => void) =>  { tank.setSpeed(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.setSpeed =  speed => new Promise((resolve, reject) => _bot_setSpeed(speed, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(context, {})

  // Expose getOrientation
  context.global.setSync("_bot_getOrientation", () => new ivm.ExternalCopy(tank.getOrientation()) )
  isolate.compileScriptSync(`
    bot.getOrientation = () => _bot_getOrientation().copy()
  `).runSync(context, {})

  // Expose setOrientation
  context.global.setSync("_bot_setOrientation", (arg: number, resolve: () => void, reject: () => void) =>  { tank.setOrientation(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.setOrientation = orientation => new Promise((resolve, reject) => _bot_setOrientation(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(context, {})

  // Expose setName
  context.global.setSync("_bot_setName", (arg: string) =>  { tank.setName(arg) } )
  isolate.compileScriptSync(`
    bot.setName = name => _bot_setName(name)
  `).runSync(context, {})

  // Expose getHealth
  context.global.setSync("_bot_getHealth", () => new ivm.ExternalCopy(tank.getHealth()) )
  isolate.compileScriptSync(`
    bot.getHealth = () => _bot_getHealth().copy()
  `).runSync(context, {})
  
  // Expose isTurning
  context.global.setSync("_bot_isTurning", () => new ivm.ExternalCopy(tank.isTurning()) )
  isolate.compileScriptSync(`
    bot.isTurning = () => _bot_isTurning().copy()
  `).runSync(context, {})

  // Expose turn
  context.global.setSync("_bot_turn", (arg: number, resolve: () => void, reject: () => void) =>  { tank.turn(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.turn = orientation => new Promise((resolve, reject) => _bot_turn(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(context, {})

  // Expose getX
  context.global.setSync("_bot_getX", () => new ivm.ExternalCopy(tank.getX()) )
  isolate.compileScriptSync(`
    bot.getX = () => _bot_getX().copy()
  `).runSync(context, {})

  // Expose getY
  context.global.setSync("_bot_getY", () => new ivm.ExternalCopy(tank.getY()) )
  isolate.compileScriptSync(`
    bot.getY = () => _bot_getY().copy()
  `).runSync(context, {})

  // Expose send
  context.global.setSync("_bot_send", (arg: number) =>  { tank.send(arg) } )
  isolate.compileScriptSync(`
    bot.send = message => _bot_send(message)
  `).runSync(context, {})      
}

export default {
  // Initialize a tank with its application logic, compiles the app source code
  // within a sandboxed environment.
  compile: (
    arena: Arena,
    process: Process,
    tank: Tank
  ) => {

    const app = process.app

    // Build and execute the tank logic in a sandboxed environment
    try {
      tank.handlers = {}

      // todo reuse across tanks
      const isolate = new ivm.Isolate({ memoryLimit: 8 });

      const context = isolate.createContextSync();
      context.global.setSync('_ivm', ivm)

      // Expose tank
      isolate.compileScriptSync(`const bot={radar: {}, turret: {}}`).runSync(context, {})
      exposeTank(tank, isolate, context)
      exposeTankRadar(tank, isolate, context)
      exposeTankTurret(tank, isolate, context)

      // Expose scheduler / timers
      const scheduler = createTimerWrappers(tank)
      context.global.setSync("_setInterval", (func: () => void, interval: number) =>  { scheduler.setInterval(func, interval) } )
      context.global.setSync("_clearInterval", (id: number) =>  { scheduler.clearInterval(id) } )
      isolate.compileScriptSync(`
        setInterval = (func, interval) => _setInterval(new _ivm.Callback(() => func()), interval)
        clearInterval = (id) => _clearInterval(id)
      `).runSync(context, {})

      context.global.setSync("_setTimeout", (func: () => void, interval: number) =>  { scheduler.setTimeout(func, interval) } )
      context.global.setSync("_clearTimeout", (id: number) =>  { scheduler.clearTimeout(id) } )
      isolate.compileScriptSync(`
        setTimeout = (func, interval) => _setTimeout(new _ivm.Callback(() => func()), interval)
        clearTimeout = (id) => _clearTimeout(id)
      `).runSync(context, {})

    
      // Expose clock
      // TODO .on(Event.TICK, ...)
      context.global.setSync("_clock_getTime", () => new ivm.ExternalCopy(arena.clock.time) )
      isolate.compileScriptSync(`
        clock.getTime = () => _clock_getTime().copy()
      `).runSync(context, {})

      // Expose console / logger
      const streams = [
        {
          level: 'TRACE',
          stream: {write: (entry) => { arena.emitter.emit("log", {...entry, time: arena.clock.time, id: uuidv4() }) } },
        },
      ]
      const tankId =
          (arena.processes.map(process => process.app.id).indexOf(app.id) + 1) * 10 +
          ((arena.processes.find(process => process.app.id===app.id)?.tanks.map(tank=>tank.id).indexOf(tank.id) || 0) + 1)
    
      tank.logger = createLogger({
        name: app.name + ' <' + tankId + '>',
        streams,
      })

      context.global.setSync("_log", (msg: any, ...msgs:any[]) =>  { console.log(msg, ...msgs); tank.logger.info(msg, ...msgs)} )
      // TODO better log-level support
      isolate.compileScriptSync(`
        logger = {};
        logger.log = _log;
        logger.info = _log;
        logger.trace = _log;
        logger.debug = _log;
        logger.warn = _log;
        logger.error = _log;
        console = {log: _log};
      `).runSync(context, {})

      // Expose Event definitions
      isolate.compileScriptSync(`
        Event = {
          RECEIVED: 'RECEIVED',
          FIRED:'FIRED',
          SCANNED:'SCANNED',
          COLLIDED:'COLLIDED',
          START:'START',
          TICK:'TICK',
          HIT: 'HIT',
          DETECTED:'DETECTED',          
        }
    `).runSync(context, {})

    console.log('run untrusted')
    isolate.compileScriptSync(app.source).runSync(context, {timeout: 5000})
    console.log('ran untrusted')
    } catch (e) {
      console.log('2>', e)
    }
  },
}
