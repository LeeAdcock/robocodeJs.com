import TankApp from './tankApp'

interface Clock {
    time: number
}

export default interface Arena {
    apps: TankApp[]
    clock: Clock
    height: number
    width: number
}
