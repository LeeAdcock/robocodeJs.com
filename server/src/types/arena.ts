import Clock from './clock'
import {EventEmitter} from 'events'
import Process from './process'

export default class Arena {
  height = 750
  width = 750
  clock: Clock = new Clock()
  emitter: EventEmitter = new EventEmitter()
  processes: Process[] = []
  running = false

  getWidth = () => this.width
  getHeight = () => this.height
}
