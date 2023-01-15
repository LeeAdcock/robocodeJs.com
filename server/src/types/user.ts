import { v4 as uuidv4 } from "uuid";
import { UserAuth } from "./userAuth";

// eslint-disable-next-line @typescript-eslint/ban-types
export type UserId = string & {};

export default class User {
  private id: UserId = "";
  private name: string | undefined;
  private picture: string | undefined;
  private email: string | undefined;

  private auths: UserAuth[] = [];

  constructor(
    name: string | undefined,
    picture: string | undefined,
    email: string | undefined
  ) {
    this.id = uuidv4();
    this.name = name;
    this.picture = picture;
    this.email = email;
  }
  getId(): UserId {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getPicture() {
    return this.picture;
  }
  getEmail() {
    return this.email;
  }

  addAuth(auth: UserAuth) {
    this.auths.push(auth);
  }
  getAuths() {
    return this.auths;
  }
}
