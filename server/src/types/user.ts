import { Arena, TankApp } from '@battletank/lib'

export default class User {
  id: string = ""
  apps: TankApp[] = []
  arena: Arena = new Arena()
  name: string | undefined;
  picture: string | undefined;
  email: string | undefined;
}
