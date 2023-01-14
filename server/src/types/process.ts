import TankApp from './app'
import Tank from './tank'

export default class Process {
  constructor(app:TankApp) {
    this.app = app
  }
  app: TankApp
  tanks: Tank[] = []
}
