import pool from '../util/db';
import { UserId } from './user';
import nameFactory from '../util/nameFactory';

export type AppId = string & {};

export default class App {
  private id: AppId;
  private name: string;
  private userId: UserId;
  private source = '';

  constructor(id: AppId, userId: UserId) {
    this.id = id;
    this.userId = userId;
    this.name = nameFactory();
  }

  getId = () => this.id;
  getUserId = () => this.userId;

  // Populate fields from persistence without writing them back to the database
  // (setName/setSource persist; this is for hydrating a loaded record).
  hydrate = (name: string, source: string): App => {
    this.name = name;
    // Coerce a NULL/undefined source (legacy rows created before the column
    // defaulted to '') to an empty string so getSource always returns a string.
    this.source = source ?? '';
    return this;
  };

  getSource = () => this.source || '';
  setSource = (source: string): Promise<undefined> => {
    this.source = source;
    return pool
      .query({
        text: 'UPDATE app SET source=$2, updatedTimestamp=CURRENT_TIMESTAMP WHERE id=$1',
        values: [this.getId(), source],
      })
      .then(() => undefined);
  };

  getName = () => this.name || 'Unnamed';
  setName = (name: string): Promise<undefined> => {
    this.name = name;
    return pool
      .query({
        text: 'UPDATE app SET name=$2, updatedTimestamp=CURRENT_TIMESTAMP WHERE id=$1',
        values: [this.getId(), name],
      })
      .then(() => undefined);
  };

  delete = (): Promise<undefined> => {
    return pool
      .query({
        text: 'UPDATE app SET deleted=true, updatedTimestamp=CURRENT_TIMESTAMP WHERE id=$1',
        values: [this.getId()],
      })
      .then(() => undefined);
  };
}
