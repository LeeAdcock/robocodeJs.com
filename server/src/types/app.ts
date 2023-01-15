import { v4 as uuidv4 } from "uuid";
import arenaService from "../services/ArenaService";
import User, { UserId } from "./user";
import nameFactory from "../util/nameFactory";

// eslint-disable-next-line @typescript-eslint/ban-types
export type AppId = string & {};

export default class App {
  private id: AppId;
  private name: string;
  private userId: UserId;
  private source = "";

  constructor(user: User) {
    this.userId = user.getId();
    this.id = uuidv4();
    this.name = nameFactory();
  }

  getId = () => this.id;
  getUserId = () => this.userId;

  getSource = () => this.source;
  setSource = (source: string) => {
    this.source = source;
  };

  getName = () => this.name;
  setName = (name: string) => {
    this.name = name;
    const arenas = arenaService.getForApp(this.getId());
    arenas.forEach((arena) =>
      arena.emit("event", {
        type: "appRenamed",
        appId: this.getId(),
        name: name,
      })
    );
  };
}
