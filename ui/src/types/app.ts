import Bot from './bot';

export default interface App {
  id: string;
  name: string;
  bots: Bot[];
}
