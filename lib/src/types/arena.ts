import Clock from './clock'
import {EventEmitter} from 'events'
import Process from './process'

export default class Arena {
  height: number = 750
  width: number = 750
  clock: Clock = new Clock()
  emitter: EventEmitter = new EventEmitter()
  processes: Process[] = []
  running: boolean = false
}
