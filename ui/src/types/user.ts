import TankApp from './tankApp';

export default interface User {
  id: string;
  name: string;
  picture: string;
  email: string;

  apps: TankApp[];
}
