import User, { UserId } from "../types/user";
import { v4 as uuidv4 } from "uuid";
import arenaService from "./ArenaService";
import pool from "../util/db";

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
  create = (
    name: string | undefined,
    picture: string | undefined,
    email: string | undefined
  ): Promise<User> => {
    const userId:UserId = uuidv4();
    const user = new User(userId, name, picture, email);
    console.log("creating user", userId)
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
        arenaService.create(user.getId()).then(() => Promise.resolve(user))
      );
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
