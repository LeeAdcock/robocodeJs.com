import { v4 as uuidv4 } from "uuid";
import arenaService from "../services/ArenaService";
import User, { UserId } from "./user";

// eslint-disable-next-line @typescript-eslint/ban-types
export type AppId = string & {};

export default class App {
  setName(name: string) {
    this.name = name;
    const arenas = arenaService.getForApp(this.getId());
    arenas.forEach((arena) =>
      arena.emit("event", {
        type: "appRenamed",
        appId: this.getId(),
        name: name,
      })
    );
  }
  constructor(user: User) {
    this.userId = user.getId();
    this.id = uuidv4();

    const adjs = [
        "autumn",
        "hidden",
        "bitter",
        "misty",
        "silent",
        "empty",
        "dry",
        "dark",
        "summer",
        "icy",
        "delicate",
        "quiet",
        "white",
        "cool",
        "spring",
        "winter",
        "patient",
        "twilight",
        "dawn",
        "crimson",
        "wispy",
        "weathered",
        "blue",
        "billowing",
        "broken",
        "cold",
        "damp",
        "falling",
        "frosty",
        "green",
        "long",
        "late",
        "lingering",
        "bold",
        "little",
        "morning",
        "muddy",
        "old",
        "red",
        "rough",
        "still",
        "small",
        "sparkling",
        "throbbing",
        "shy",
        "wandering",
        "withered",
        "wild",
        "black",
        "young",
        "holy",
        "solitary",
        "fragrant",
        "aged",
        "snowy",
        "proud",
        "floral",
        "restless",
        "divine",
        "polished",
        "ancient",
        "purple",
        "lively",
        "nameless",
      ],
      nouns = [
        "waterfall",
        "river",
        "breeze",
        "moon",
        "rain",
        "wind",
        "sea",
        "morning",
        "snow",
        "lake",
        "sunset",
        "pine",
        "shadow",
        "leaf",
        "dawn",
        "glitter",
        "forest",
        "hill",
        "cloud",
        "meadow",
        "sun",
        "glade",
        "bird",
        "brook",
        "butterfly",
        "bush",
        "dew",
        "dust",
        "field",
        "fire",
        "flower",
        "firefly",
        "feather",
        "grass",
        "haze",
        "mountain",
        "night",
        "pond",
        "darkness",
        "snowflake",
        "silence",
        "sound",
        "sky",
        "shape",
        "surf",
        "thunder",
        "violet",
        "water",
        "wildflower",
        "wave",
        "water",
        "resonance",
        "sun",
        "wood",
        "dream",
        "cherry",
        "tree",
        "fog",
        "frost",
        "voice",
        "paper",
        "frog",
        "smoke",
        "star",
      ];

    this.name =
      "Bot " +
      adjs[Math.floor(Math.random() * (adjs.length - 1))] +
      " " +
      nouns[Math.floor(Math.random() * (nouns.length - 1))];
  }

  private id: AppId;
  private name: string;
  private userId: UserId;
  private source = "";

  getSource = () => this.source;
  getUserId = () => this.userId;
  getId = () => this.id;
  getName = () => this.name;
  setSource = (source: string) => {
    this.source = source;
  };
}
