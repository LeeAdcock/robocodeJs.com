import { UserId } from "./user";

// eslint-disable-next-line @typescript-eslint/ban-types
export type ArenaId = string & {};

export default class Arena {
  private id: ArenaId;
  private userId: UserId;
  private height = 750;
  private width = 750;

  constructor(id: ArenaId, userId: UserId) {
    this.id = id;
    this.userId = userId;
  }

  getId = () => this.id;
  getUserId = () => this.userId;
  getWidth = () => this.width;
  getHeight = () => this.height;
}
