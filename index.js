import config from "./utils/config.js";
import { initRepo } from "./ostree/ostreeManager.js";
import fetchAppstream from "./mirror/fetchAppstream.js";
import { fetchPackage } from "./mirror/fetchPackage.js";

import dotenv from "dotenv";

// Load environment variables
dotenv.config();

console.log("=== usrpkg-builder ===");
console.log("Flatpak repo management tool\n");

// Initialize the repository
await initRepo();

config.repo_remotes.forEach(async (remote) => {
  console.log(`Mirroring ${remote.name}...`);

  // get appsteam
  const appstream_url = `${remote.url}/appstream/x86_64/appstream.xml.gz`;
  const appstream_data = await fetchAppstream(appstream_url);

  // Fetch packages for each component
  for (const component of appstream_data.components.component.slice(0, 3)) {
    console.log(`Fetching package ${component.id}...`);
    //await fetchPackage(remote.name, component.id, "x86_64");
    const bundle = component.bundle[0]?.["$"];
    const runtime = bundle?.runtime;
    const sdk = bundle?.sdk;

    if (runtime) {
      console.log(`Fetching runtime: ${runtime}`);
      await fetchPackage(remote.name, "runtime/" + runtime);
    }

    if (sdk) {
      console.log(`Fetching SDK: ${sdk}`);
      await fetchPackage(remote.name, "runtime/" + sdk);
    }
  }
});
