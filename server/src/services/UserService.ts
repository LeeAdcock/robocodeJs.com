import User, { UserId } from "../types/user";
import { v4 as uuidv4 } from "uuid";
import arenaService from "./ArenaService";
import pool from "../util/db";
import appService from "./AppService";
import arenaMemberService from "./ArenaMemberService";
import environmentService from "./EnvironmentService";

pool.query(`
  CREATE TABLE IF NOT EXISTS account (
    id UUID,
    name text,
    picture text,
    email text,
    createdTimestamp timestamp default CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )
`);

class UserService {
  static demoUserId: UserId = "c8c62d4b-37bc-45af-a86a-0e9d654aef13";

  create = (
    name: string | undefined,
    picture: string | undefined,
    email: string | undefined,
    demo = false
  ): Promise<User> => {
    const userId: UserId = demo ? UserService.demoUserId : uuidv4();
    const user = new User(userId, name, picture, email);
    console.log("creating user", userId);
    return pool
      .query({
        text: "INSERT INTO account(id, name, picture, email) VALUES($1, $2, $3, $4)",
        values: [
          user.getId(),
          user.getName(),
          user.getPicture(),
          user.getEmail(),
        ],
      })
      .then(() =>
        arenaService.create(user.getId()).then((arena) =>
          Promise.all([
            appService.create(user.getId()).then((app) => {
              app.setName("My First Bot");
              app
                .setSource(
                  `
// Set the bot's name
bot.setName('My First Bot')

// Begin accelerating
bot.setSpeed(2)

// Fire when turret is ready
function fireIfReady() {
  if(bot.turret.isReady()) {
    bot.turret.fire()
  }
}
clock.on(Event.TICK, fireIfReady)

// After firing, turn to the right
function turnRight() {
  bot.turn(10)  
}
bot.on(Event.FIRED, turnRight)
              `
                )
                .then(() =>
                  arenaMemberService.create(arena.getId(), app.getId())
                );
            }),
            appService.create(user.getId()).then((app) => {
              app.setName("Target Practice");
              app
                .setSource(
                  `
// Set the bot's name
bot.setName('Target Practice')
`
                )
                .then(() =>
                  arenaMemberService.create(arena.getId(), app.getId())
                );
            }),
          ])
            .then(() =>
              environmentService.get(arena).then((env) => env.resume())
            )
            .then(() => user)
        )
      );
  };

  getDemoUser = (): Promise<User> => {
    return this.get(UserService.demoUserId).then((user) => {
      if (!user) {
        return this.create("demo", undefined, undefined, true);
      }
      return user;
    });
  };

  get = (userId: UserId): Promise<User | undefined> => {
    return pool
      .query({
        text: "SELECT account.name, account.picture, account.email FROM account WHERE id=$1",
        values: [userId],
      })
      .then((res) => {
        return res.rowCount === 0
          ? undefined
          : new User(
              userId,
              res.rows[0].name,
              res.rows[0].picture,
              res.rows[0].email
            );
      });
  };
}

export default new UserService();
