import Tank from './tank'

export default interface App {
    id: string
    name: string
    tanks: Tank[]
}
