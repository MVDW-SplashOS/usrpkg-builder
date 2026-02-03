import * as mysql from "promise-mysql";

export const con = await mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASS,
  database: process.env.MYSQLDB,
  charset: "utf8mb4",
  collation: "utf8mb4_bin",
  multipleStatements: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
});
