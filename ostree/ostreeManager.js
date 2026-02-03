import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { Builder } from "xml2js";

import config from "../utils/config.js";

const execAsync = promisify(exec);

export async function initRepo() {
  const repoPath = config.repo_name;

  // Check if repository is properly initialized by looking for the objects directory
  const objectsPath = path.join(repoPath, "objects");
  let needsInit = false;

  try {
    await fs.access(objectsPath);
    console.log(`Repository already initialized: ${repoPath}`);
  } catch (error) {
    needsInit = true;
  }

  if (needsInit) {
    console.log(`Initializing repository: ${repoPath}`);
    const command = `ostree init --repo=${repoPath} --mode=archive-z2`;

    try {
      const { stderr } = await execAsync(command);
      if (stderr) {
        console.warn(`Command stderr: ${stderr}`);
      }
      console.log(`✓ Repository initialized: ${repoPath}`);
    } catch (error) {
      throw new Error(`Failed to run ostree init: ${error.message}`);
    }
  }

  // Create necessary Flatpak directory structure
  await ensureFlatpakStructure();

  // Add remotes
  if (config.repo_remotes && Array.isArray(config.repo_remotes)) {
    for (const remote of config.repo_remotes) {
      const checkRemoteCommand = `ostree remote list --repo=${repoPath}`;
      let remoteExists = false;

      try {
        const { stdout } = await execAsync(checkRemoteCommand);
        if (stdout.includes(remote.name)) {
          remoteExists = true;
          console.log(`Remote already exists: ${remote.name}`);
        }
      } catch (error) {}

      if (!remoteExists) {
        const addRemoteCommand = `ostree remote add --repo=${repoPath} --no-gpg-verify ${remote.name} ${remote.url}`;
        try {
          const { stderr } = await execAsync(addRemoteCommand);
          if (stderr) {
            console.warn(`Command stderr for remote ${remote.name}: ${stderr}`);
          }
          console.log(`✓ Added remote: ${remote.name}`);
        } catch (error) {
          throw new Error(
            `Failed to add remote ${remote.name}: ${error.message}`,
          );
        }
      }
    }
  }
}

async function ensureFlatpakStructure() {
  const repoPath = config.repo_name;

  // Create appstream directory structure
  const appstreamDir = path.join(repoPath, "appstream");
  const x86_64Dir = path.join(appstreamDir, "x86_64");
  const iconsDir = path.join(x86_64Dir, "icons");
  const activeDir = path.join(x86_64Dir, "active");

  try {
    await fs.mkdir(appstreamDir, { recursive: true });
    await fs.mkdir(x86_64Dir, { recursive: true });
    await fs.mkdir(iconsDir, { recursive: true });
    await fs.mkdir(activeDir, { recursive: true });
    console.log("✓ Created Flatpak directory structure");
  } catch (error) {
    console.warn(
      `Warning: Could not create directory structure: ${error.message}`,
    );
  }
}

export async function generateAppstream(components) {
  const repoPath = config.repo_name;

  // Create appstream directory in active location (required for flatpak build-update-repo)
  const activeDir = path.join(repoPath, "appstream", "x86_64", "active");
  const appstreamPath = path.join(activeDir, "appstream.xml");

  // Build XML from components
  const appstreamData = {
    components: {
      $: { version: "0.14" },
      component: components,
    },
  };

  const builder = new Builder({
    xmldec: { version: "1.0", encoding: "UTF-8" },
  });
  const xml = builder.buildObject(appstreamData);

  // Write XML to active directory
  await fs.writeFile(appstreamPath, xml);
  console.log(`✓ Generated appstream.xml with ${components.length} components`);

  // Compress it
  const zlib = await import("zlib");
  const content = await fs.readFile(appstreamPath);
  const compressed = zlib.gzipSync(content);
  await fs.writeFile(appstreamPath + ".gz", compressed);
  console.log(`✓ Compressed to appstream.xml.gz`);

  // Also copy to the standard location for backward compatibility
  const standardDir = path.join(repoPath, "appstream", "x86_64");
  try {
    await fs.copyFile(appstreamPath, path.join(standardDir, "appstream.xml"));
    await fs.copyFile(
      appstreamPath + ".gz",
      path.join(standardDir, "appstream.xml.gz"),
    );
  } catch (error) {
    console.warn(
      `Warning: Could not copy to standard location: ${error.message}`,
    );
  }
}

export async function createSummary() {
  const repoPath = config.repo_name;

  console.log("Updating repository metadata...");

  // Use flatpak build-update-repo which handles everything properly
  // Including committing appstream data to OSTree refs
  const buildUpdateCommand = `flatpak build-update-repo ${repoPath}`;

  try {
    const { stdout, stderr } = await execAsync(buildUpdateCommand);

    // Show relevant output
    if (stdout) {
      const lines = stdout.trim().split("\n");
      // Show important messages
      lines.forEach((line) => {
        if (
          line.includes("Updating") ||
          line.includes("commit") ||
          line.includes("appstream")
        ) {
          console.log(`  ${line}`);
        }
      });
    }

    if (stderr && !stderr.includes("warning")) {
      console.warn(`build-update-repo stderr: ${stderr}`);
    }

    console.log(`✓ Updated Flatpak repository successfully`);
    console.log(`  - OSTree summary updated`);
    console.log(
      `  - Appstream refs committed (appstream/x86_64, appstream2/x86_64)`,
    );
    console.log(`  - Repository metadata updated`);
  } catch (error) {
    console.error(`✗ flatpak build-update-repo failed: ${error.message}`);
    console.log(`\nTrying manual approach...`);
    await manualUpdate();
  }
}

async function manualUpdate() {
  const repoPath = config.repo_name;

  // Step 1: Commit appstream data manually
  console.log("Step 1: Committing appstream data to OSTree...");
  const activeDir = path.join(repoPath, "appstream", "x86_64", "active");

  try {
    // Check if active directory has content
    const files = await fs.readdir(activeDir);
    if (files.length === 0) {
      console.warn("  ⚠ No appstream files to commit");
    } else {
      // Commit to both refs that Flatpak might look for
      const refs = ["appstream/x86_64", "appstream2/x86_64"];

      for (const ref of refs) {
        const commitCmd = `ostree commit --repo=${repoPath} --branch=${ref} --subject="Update appstream" ${activeDir}`;
        try {
          await execAsync(commitCmd);
          console.log(`  ✓ Appstream committed to ref: ${ref}`);
        } catch (error) {
          console.warn(`  ⚠ Could not commit to ${ref}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.warn(`  ⚠ Could not commit appstream: ${error.message}`);
  }

  // Step 2: Update OSTree summary
  console.log("Step 2: Updating OSTree summary...");
  try {
    await execAsync(`ostree summary -u --repo=${repoPath}`);
    console.log("  ✓ OSTree summary updated");
  } catch (error) {
    throw new Error(`Failed to update summary: ${error.message}`);
  }

  // Step 3: Add Flatpak metadata
  console.log("Step 3: Adding Flatpak metadata...");
  await addFlatpakMetadata();

  console.log("✓ Manual update complete");
}

async function addFlatpakMetadata() {
  const repoPath = config.repo_name;

  const metadata = [
    { key: "xa.title", value: config.repo_name },
    { key: "xa.comment", value: "Mirrored Flatpak Repository" },
    {
      key: "xa.homepage",
      value: "http://192.168.3.140/usrpkg-builder/usrpkg-repo/",
    },
  ];

  for (const { key, value } of metadata) {
    try {
      await execAsync(
        `ostree summary --repo=${repoPath} --add-metadata ${key}=s:'${value}'`,
      );
      console.log(`  ✓ Added ${key}`);
    } catch (error) {
      console.warn(`  ⚠ Could not add ${key}: ${error.message}`);
    }
  }
}
