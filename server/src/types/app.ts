import pool from "../util/db";
import { UserId } from "./user";
import nameFactory from "../util/nameFactory";

// eslint-disable-next-line @typescript-eslint/ban-types
export type AppId = string & {};

export default class App {
  private id: AppId;
  private name: string;
  private userId: UserId;
  private source = "";

  constructor(id: AppId, userId: UserId) {
    this.id = id;
    this.userId = userId;
    this.name = nameFactory();
  }

  getId = () => this.id;
  getUserId = () => this.userId;

  getSource = () => this.source || "";
  setSource = (source: string): Promise<undefined> => {
    this.source = source;
    return pool
      .query({
        text: "UPDATE app SET source=$2, updatedTimestamp=CURRENT_TIMESTAMP WHERE id=$1",
        values: [this.getId(), source],
      })
      .then(() => undefined);
  };

  getName = () => this.name || "Unnamed";
  setName = (name: string): Promise<undefined> => {
    this.name = name;
    // todo debounce
    return pool
      .query({
        text: "UPDATE app SET name=$2, updatedTimestamp=CURRENT_TIMESTAMP WHERE id=$1",
        values: [this.getId(), name],
      })
      .then(() => undefined);
  };

  delete = (): Promise<undefined> => {
    return pool
      .query({
        text: "UPDATE app SET deleted=true, updatedTimestamp=CURRENT_TIMESTAMP WHERE id=$1",
        values: [this.getId()],
      })
      .then(() => undefined);
  };
}
