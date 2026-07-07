import App from './app';

export default interface User {
  id: string;
  name: string;
  picture: string;
  email: string;

  apps: App[];
}
