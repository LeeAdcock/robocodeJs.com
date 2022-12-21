import TankApp from './tankApp'

export default interface User {
    id
    name: string
    picture: string
    email: string

    apps: TankApp[]
}
