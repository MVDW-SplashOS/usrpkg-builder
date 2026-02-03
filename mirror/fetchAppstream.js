import fs from "fs";
import zlib from "zlib";
import path from "path";
import { parseString } from "xml2js";

const gzPath = path.join("/tmp", "appstream.xml.gz");
const xmlPath = path.join("/tmp", "appstream.xml");

const fetchAppstream = async (url) => {
  // Check if cached XML file already exists
  if (fs.existsSync(xmlPath)) {
    console.log("Using cached XML file");
    return new Promise((resolve, reject) => {
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
  }
  console.log("Downloading XML file");

  // If not cached, download and process
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

// Export both as default and named export for compatibility
export default fetchAppstream;
export { fetchAppstream };
