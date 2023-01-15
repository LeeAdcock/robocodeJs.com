import User from "../types/user";
import arenaService from "../services/ArenaService";

class UserService {
  users: User[] = [];
  create = (
    name: string | undefined,
    picture: string | undefined,
    email: string | undefined
  ): User => {
    const user = new User(name, picture, email);
    arenaService.create(user);

    this.put(user);

    return user;
  };
  authenticate = (source: string, id: string) =>
    this.users.find((user) =>
      user.getAuths().find((auth) => auth.source === source && auth.id === id)
    );
  get = (userId: string) => this.users.find((user) => user.getId() === userId);
  put = (user: User) => this.users.push(user);
}

export default new UserService();
