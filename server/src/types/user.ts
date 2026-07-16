export type UserId = string & {};

// The fixed id of the shared demo user (the unauthenticated /api/demo arena runs
// as this account). Defined on this zero-import leaf module so both UserService
// and AppService can reference it without an import cycle — e.g. to keep the
// demo's bots out of the global ladder rankings (GitHub #151).
export const DEMO_USER_ID: UserId = 'c8c62d4b-37bc-45af-a86a-0e9d654aef13';

export default class User {
  private id: UserId = '';
  private name: string | undefined;
  private picture: string | undefined;
  private email: string | undefined;
  // When the account was created. Optional because the create path knows the row
  // it just wrote without reading it back; only UserService.get hydrates it.
  // Drives the "member since" line and the anniversary badge (GitHub #121).
  private createdTimestamp: Date | undefined;

  constructor(
    id: UserId,
    name: string | undefined,
    picture: string | undefined,
    email: string | undefined,
    createdTimestamp?: Date
  ) {
    this.id = id;
    this.name = name;
    this.picture = picture;
    this.email = email;
    this.createdTimestamp = createdTimestamp;
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
  getCreatedTimestamp() {
    return this.createdTimestamp;
  }
}
