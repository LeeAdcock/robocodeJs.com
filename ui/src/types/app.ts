import Bot from './bot';

export default interface App {
  id: string;
  name: string;
  bots: Bot[];
  // Whether the owner has made the source public (GitHub #117). Only present
  // on the editor's GET /api/user/:userId/app/:appId metadata, not on the
  // arena snapshot's apps.
  public?: boolean;
}
