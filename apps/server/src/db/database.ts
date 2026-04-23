import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

import type { AppConfig } from "../config/env.js";

import { migrate } from "./schema.js";

export type DatabaseConnection = Database.Database;

export function openDatabase(config: Pick<AppConfig, "DB_PATH">): DatabaseConnection {
  const databasePath = resolve(config.DB_PATH);
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  migrate(database);

  return database;
}
