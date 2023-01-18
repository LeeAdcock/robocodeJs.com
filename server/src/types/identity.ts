import { UserId } from "./user";

export default class UserAuth {
  private userId: UserId;
  private source: string;
  private sourceId: string;

  constructor(userId: UserId, source: string, sourceId: string) {
    this.userId = userId;
    this.source = source;
    this.sourceId = sourceId;
  }

  getUserId = () => this.userId;
  getSource = () => this.source;
  getSourceId = () => this.sourceId;
}
