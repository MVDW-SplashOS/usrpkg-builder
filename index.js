import config from "./utils/config.js";
import {
  initRepo,
  createSummary,
  generateAppstream,
} from "./ostree/ostreeManager.js";
import fetchAppstream from "./mirror/fetchAppstream.js";
import { fetchPackage } from "./mirror/fetchPackage.js";
import fs from "fs/promises";
import path from "path";

import dotenv from "dotenv";

// Load environment variables
dotenv.config();

console.log("=== usrpkg-builder ===");
console.log("Flatpak repo management tool\n");

// Initialize the repository
await initRepo();

// Track all components we successfully mirror
const mirroredComponents = [];

// Process each remote
for (const remote of config.repo_remotes) {
  console.log(`\nMirroring from ${remote.name}...`);

  // Get appstream
  const appstream_url = `${remote.url}/appstream/x86_64/appstream.xml.gz`;
  const appstream_data = await fetchAppstream(appstream_url);

  // Fetch packages for each component (limiting to first 3 for testing)
  // To mirror more apps, change .slice(0, 3) to .slice(0, 10) or remove it entirely
  const components = appstream_data.components.component.slice(0, 3);

  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    const appId = component.id?.[0] || "unknown";

    console.log(`\n[${i + 1}/${components.length}] Processing ${appId}...`);

    try {
      // Get bundle information
      const bundle = component.bundle?.[0]?.["$"];
      if (!bundle) {
        console.log(`  ⚠ No bundle information found, skipping`);
        continue;
      }

      const runtime = bundle?.runtime;
      const sdk = bundle?.sdk;
      let appFetched = false;

      // Fetch the application itself
      if (bundle.type === "flatpak") {
        const appRef = `app/${appId}/x86_64/stable`;
        console.log(`  → Fetching app: ${appRef}`);
        try {
          await fetchPackage(remote.name, appRef);
          console.log(`  ✓ App fetched successfully`);
          appFetched = true;
        } catch (error) {
          console.error(`  ✗ Failed to fetch app: ${error.message}`);
        }
      }

      // Fetch runtime if specified
      if (runtime) {
        console.log(`  → Fetching runtime: ${runtime}`);
        try {
          await fetchPackage(remote.name, "runtime/" + runtime);
          console.log(`  ✓ Runtime fetched successfully`);
        } catch (error) {
          console.error(`  ✗ Failed to fetch runtime: ${error.message}`);
        }
      }

      // Fetch SDK if specified (optional, usually not needed for end users)
      // Uncomment if you want to mirror SDKs too
      /*
      if (sdk) {
        console.log(`  → Fetching SDK: ${sdk}`);
        try {
          await fetchPackage(remote.name, "runtime/" + sdk);
          console.log(`  ✓ SDK fetched successfully`);
        } catch (error) {
          console.error(`  ✗ Failed to fetch SDK: ${error.message}`);
        }
      }
      */

      // If app was successfully fetched, add to mirrored components
      if (appFetched) {
        mirroredComponents.push(component);
      }
    } catch (error) {
      console.error(`  ✗ Error processing ${appId}: ${error.message}`);
    }
  }

  console.log(`\nCompleted mirroring from ${remote.name}`);
}

// Generate appstream metadata for mirrored apps
if (mirroredComponents.length > 0) {
  console.log(
    `\nGenerating appstream metadata for ${mirroredComponents.length} apps...`,
  );
  await generateAppstream(mirroredComponents);
} else {
  console.log(
    `\n⚠ No apps were successfully mirrored, skipping appstream generation`,
  );
}

// Update the repository summary after all packages are fetched
console.log("\nUpdating repository metadata...");
await createSummary();

// Generate .flatpakrepo file for easy client setup
console.log("\nGenerating .flatpakrepo file...");
await generateFlatpakrepoFile();

console.log("\n✓ Repository update complete!");
console.log(`Repository location: ${config.repo_name}`);
console.log(`Mirrored ${mirroredComponents.length} applications`);
console.log(
  `\nYou can now serve this repository via HTTP and add it to Flatpak clients.`,
);
console.log(`\nClients can add the repository using:`);
console.log(
  `  flatpak remote-add --user ${config.repo_name} http://192.168.3.140/usrpkg-builder/usrpkg-repo/${config.repo_name}.flatpakrepo`,
);
console.log(`\nOr directly:`);
console.log(
  `  flatpak remote-add --user --no-gpg-verify ${config.repo_name} http://192.168.3.140/usrpkg-builder/usrpkg-repo/`,
);
console.log(`\nThen update appstream:`);
console.log(`  flatpak update --appstream ${config.repo_name}`);

async function generateFlatpakrepoFile() {
  const repoPath = config.repo_name;
  const repoUrl = "http://192.168.3.140/usrpkg-builder/usrpkg-repo/";
  const repoTitle =
    config.repo_title || config.repo_name || "UsrPkg Repository";

  const flatpakrepoContent = `[Flatpak Repo]
Title=${repoTitle}
Url=${repoUrl}
Homepage=${repoUrl}
Comment=Local Flatpak mirror
Description=Mirrored Flatpak packages for local network use
GPGVerify=false
`;

  const outputPath = path.join(repoPath, `${config.repo_name}.flatpakrepo`);

  try {
    await fs.writeFile(outputPath, flatpakrepoContent);
    console.log(`✓ Created ${config.repo_name}.flatpakrepo`);
  } catch (error) {
    console.warn(`⚠ Could not create .flatpakrepo file: ${error.message}`);
  }
}
