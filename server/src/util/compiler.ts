import Arena from '../types/arena'
import Process from '../types/process'
import Tank from '../types/tank'
import { Event } from '../types/event'
import { createTimerWrappers } from './wrappers/timerWrapper'
import ivm from 'isolated-vm';
import { createLogger } from 'browser-bunyan'
import { v4 as uuidv4 } from 'uuid';

function exposeTankRadar(tank:Tank, isolate: ivm.Isolate) {
 
  // Expose getOrientation
  tank.context.global.setSync("_bot_radar_getOrientation", () => new ivm.ExternalCopy(tank.turret.radar.getOrientation()) )
  isolate.compileScriptSync(`
    bot.radar.getOrientation = () => _bot_radar_getOrientation().copy()
  `).runSync(tank.context, {})

  // Expose setOrientation
  tank.context.global.setSync("_bot_radar_setOrientation", (arg: number, resolve: () => void, reject: () => void) =>  { tank.turret.radar.setOrientation(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.radar.setOrientation = orientation => new Promise((resolve, reject) => _bot_radar_setOrientation(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(tank.context, {})

  // Expose isTurning
  tank.context.global.setSync("_bot_radar_isTurning", () => new ivm.ExternalCopy(tank.turret.radar.isTurning()) )
  isolate.compileScriptSync(`
    bot.radar.isTurning = () => _bot_radar_isTurning().copy()
  `).runSync(tank.context, {})

  // Expose turn
  tank.context.global.setSync("_bot_radar_turn", (arg: number, resolve: () => void, reject: () => void) =>  { tank.turret.radar.turn(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.radar.turn = orientation => new Promise((resolve, reject) => _bot_radar_turn(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(tank.context, {})
  
  // Expose scan
  // todo promise return value
  tank.context.global.setSync("_bot_radar_scan", (resolve: (result: []) => void, reject: () => void) =>  { tank.turret.radar.scan().then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.radar.scan = () => new Promise((resolve, reject) => _bot_radar_scan(new _ivm.Callback((result) => resolve(result)), new _ivm.Callback(() => reject())))
  `).runSync(tank.context, {})
}

function exposeTankTurret(tank:Tank, isolate: ivm.Isolate) {
 
  // Expose getOrientation
  tank.context.global.setSync("_bot_turret_getOrientation", () => new ivm.ExternalCopy(tank.turret.getOrientation()) )
  isolate.compileScriptSync(`
    bot.turret.getOrientation = () => _bot_turret_getOrientation().copy()
  `).runSync(tank.context, {})

  // Expose setOrientation
  tank.context.global.setSync("_bot_turret_setOrientation", (arg: number, resolve: () => void, reject: () => void) =>  { tank.turret.setOrientation(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.turret.setOrientation = orientation => new Promise((resolve, reject) => _bot_turret_setOrientation(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(tank.context, {})

  // Expose isTurning
  tank.context.global.setSync("_bot_turret_isTurning", () => new ivm.ExternalCopy(tank.turret.isTurning()) )
  isolate.compileScriptSync(`
    bot.turret.isTurning = () => _bot_turret_isTurning().copy()
  `).runSync(tank.context, {})

  // Expose turn
  tank.context.global.setSync("_bot_turret_turn", (arg: number, resolve: () => void, reject: () => void) =>  { tank.turret.turn(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.turret.turn = orientation => new Promise((resolve, reject) => _bot_turret_turn(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(tank.context, {})
  
  // Expose fire
  // todo resulting value
  tank.context.global.setSync("_bot_turret_fire", (resolve: () => void, reject: () => void) =>  { tank.turret.fire().then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.turret.fire = () => new Promise((resolve, reject) => _bot_turret_fire(new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(tank.context, {})
}

function exposeTank(tank:Tank, isolate: ivm.Isolate) {

  // Expose event handler
  tank.context.global.setSync("_bot_on", (event: Event, handler: ivm.Reference) => {
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
  `).runSync(tank.context, {})

  // Expose getId
  tank.context.global.setSync("_bot_getId", () => new ivm.ExternalCopy(tank.getId()) )
  isolate.compileScriptSync(`
    bot.getId = () => _bot_getId().copy()
  `).runSync(tank.context, {})

  // Expose getSpeed
  tank.context.global.setSync("_bot_getSpeed", () => new ivm.ExternalCopy(tank.getSpeed()) )
  isolate.compileScriptSync(`
    bot.getSpeed = () => _bot_getSpeed().copy()
  `).runSync(tank.context, {})
        
  // Expose setSpeed
  tank.context.global.setSync("_bot_setSpeed", (arg: number, resolve: () => void, reject: () => void) =>  { tank.setSpeed(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.setSpeed =  speed => new Promise((resolve, reject) => _bot_setSpeed(speed, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(tank.context, {})

  // Expose getOrientation
  tank.context.global.setSync("_bot_getOrientation", () => new ivm.ExternalCopy(tank.getOrientation()) )
  isolate.compileScriptSync(`
    bot.getOrientation = () => _bot_getOrientation().copy()
  `).runSync(tank.context, {})

  // Expose setOrientation
  tank.context.global.setSync("_bot_setOrientation", (arg: number, resolve: () => void, reject: () => void) =>  { tank.setOrientation(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.setOrientation = orientation => new Promise((resolve, reject) => _bot_setOrientation(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(tank.context, {})

  // Expose setName
  tank.context.global.setSync("_bot_setName", (arg: string) =>  { tank.setName(arg) } )
  isolate.compileScriptSync(`
    bot.setName = name => _bot_setName(name)
  `).runSync(tank.context, {})

  // Expose getHealth
  tank.context.global.setSync("_bot_getHealth", () => new ivm.ExternalCopy(tank.getHealth()) )
  isolate.compileScriptSync(`
    bot.getHealth = () => _bot_getHealth().copy()
  `).runSync(tank.context, {})
  
  // Expose isTurning
  tank.context.global.setSync("_bot_isTurning", () => new ivm.ExternalCopy(tank.isTurning()) )
  isolate.compileScriptSync(`
    bot.isTurning = () => _bot_isTurning().copy()
  `).runSync(tank.context, {})

  // Expose turn
  tank.context.global.setSync("_bot_turn", (arg: number, resolve: () => void, reject: () => void) =>  { tank.turn(arg).then(resolve, reject).catch(e=>tank.logger.error(e)) } )
  isolate.compileScriptSync(`
    bot.turn = orientation => new Promise((resolve, reject) => _bot_turn(orientation, new _ivm.Callback(resolve), new _ivm.Callback(reject)))
  `).runSync(tank.context, {})

  // Expose getX
  tank.context.global.setSync("_bot_getX", () => new ivm.ExternalCopy(tank.getX()) )
  isolate.compileScriptSync(`
    bot.getX = () => _bot_getX().copy()
  `).runSync(tank.context, {})

  // Expose getY
  tank.context.global.setSync("_bot_getY", () => new ivm.ExternalCopy(tank.getY()) )
  isolate.compileScriptSync(`
    bot.getY = () => _bot_getY().copy()
  `).runSync(tank.context, {})

  // Expose send
  tank.context.global.setSync("_bot_send", (arg: number) =>  { tank.send(arg) } )
  isolate.compileScriptSync(`
    bot.send = message => _bot_send(message)
  `).runSync(tank.context, {})      
}

// Execute the tank code
const execute = (
  process: Process,
  tank: Tank) => {
    tank.handlers = {}
    tank.timers.reset()
    process.sandbox.compileScriptSync(process.app.source).runSync(tank.context, {timeout: 5000})
}

// Initialize a tank.context within the isolated sandbox
const init = (
  arena: Arena,
  process: Process,
  tank: Tank) => {

  try {    
    tank.context.global.setSync('_ivm', ivm)

    // Expose tank
    process.sandbox.compileScriptSync(`const bot={radar: {}, turret: {}}`).runSync(tank.context, {})
    exposeTank(tank, process.sandbox)
    exposeTankRadar(tank, process.sandbox)
    exposeTankTurret(tank, process.sandbox)

    // Expose scheduler / timers
    const scheduler = createTimerWrappers(tank)
    tank.context.global.setSync("_setInterval", (func: () => void, interval: number) =>  { scheduler.setInterval(func, interval) } )
    tank.context.global.setSync("_clearInterval", (id: number) =>  { scheduler.clearInterval(id) } )
    process.sandbox.compileScriptSync(`
      setInterval = (func, interval) => _setInterval(new _ivm.Callback(() => func()), interval)
      clearInterval = (id) => _clearInterval(id)
    `).runSync(tank.context, {})

    tank.context.global.setSync("_setTimeout", (func: () => void, interval: number) =>  { scheduler.setTimeout(func, interval) } )
    tank.context.global.setSync("_clearTimeout", (id: number) =>  { scheduler.clearTimeout(id) } )
    process.sandbox.compileScriptSync(`
      setTimeout = (func, interval) => _setTimeout(new _ivm.Callback(() => func()), interval)
      clearTimeout = (id) => _clearTimeout(id)
    `).runSync(tank.context, {})

  
    // Expose clock
    // TODO .on(Event.TICK, ...)
    tank.context.global.setSync("_clock_getTime", () => new ivm.ExternalCopy(arena.clock.time) )
    process.sandbox.compileScriptSync(`
      clock = {}
      clock.getTime = () => _clock_getTime().copy()
    `).runSync(tank.context, {})

    // Expose arena
    tank.context.global.setSync("_arena_getWidth", () => new ivm.ExternalCopy(arena.getWidth()) )
    tank.context.global.setSync("_arena_getHeight", () => new ivm.ExternalCopy(arena.getHeight()) )
    process.sandbox.compileScriptSync(`
      arena = {};
      arena.getWidth = () => _arena_getWidth().copy();
      arena.getHeight = () => _arena_getHeight().copy();
    `).runSync(tank.context, {})


    // Expose console / logger
    const streams = [
      {
        level: 'TRACE',
        stream: {write: (entry) => { arena.emitter.emit("log", {...entry, time: arena.clock.time, id: uuidv4() }) } },
      },
    ]
    const tankId =
        (arena.processes.map(process => process.app.id).indexOf(process.app.id) + 1) * 10 +
        ((arena.processes.find(process => process.app.id===process.app.id)?.tanks.map(tank=>tank.id).indexOf(tank.id) || 0) + 1)
  
    tank.logger = createLogger({
      name: process.app.name + ' <' + tankId + '>',
      streams,
    })

    tank.context.global.setSync("_log", (msg: any, ...msgs:any[]) =>  { console.log(msg, ...msgs); tank.logger.info(msg, ...msgs)} )
    // TODO better log-level support
    process.sandbox.compileScriptSync(`
      logger = {};
      logger.log = _log;
      logger.info = _log;
      logger.trace = _log;
      logger.debug = _log;
      logger.warn = _log;
      logger.error = _log;
      console = {log: _log};
    `).runSync(tank.context, {})

    // Expose Event definitions
    process.sandbox.compileScriptSync(`
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
  `).runSync(tank.context, {})

} catch (e) {
    console.log('2>', e)
  }
}

export default {
  execute,
  init
}
