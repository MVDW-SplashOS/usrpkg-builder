import fs from "fs";
import zlib from "zlib";
import path from "path";
import { parseString } from "xml2js";

const gzPath = path.join("/tmp", "appstream.xml.gz");
const xmlPath = path.join("/tmp", "appstream.xml");

export default async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await fs.promises.writeFile(gzPath, buffer);

  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const readStream = fs.createReadStream(gzPath);
    const writeStream = fs.createWriteStream(xmlPath);

    readStream.pipe(gunzip).pipe(writeStream);

    writeStream.on("finish", () => {
      fs.readFile(xmlPath, "utf8", (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        parseString(data, (parseErr, result) => {
          if (parseErr) {
            reject(parseErr);
            return;
          }
          resolve(result);
        });
      });
    });

    writeStream.on("error", reject);
  });
};
