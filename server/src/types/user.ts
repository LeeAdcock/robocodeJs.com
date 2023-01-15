import Arena from './arena'
import TankApp from './app'

export interface Auth {
  source: string
  id: string
}

export default class User {
  id = ""
  apps: TankApp[] = []
  arena: Arena = new Arena()
  name: string | undefined;
  picture: string | undefined;
  email: string | undefined;

  auths: Auth[] = [];
}
