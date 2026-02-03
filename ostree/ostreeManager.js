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
    // Objects directory exists, repo is likely initialized
    console.log(`Repository already initialized: ${repoPath}`);
  } catch (error) {
    // Objects directory doesn't exist, need to initialize
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
      } catch (error) {
        // Remote list failed, continue to add
      }

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

  try {
    await fs.mkdir(appstreamDir, { recursive: true });
    await fs.mkdir(x86_64Dir, { recursive: true });
    await fs.mkdir(iconsDir, { recursive: true });
    console.log("✓ Created Flatpak directory structure");
  } catch (error) {
    console.warn(
      `Warning: Could not create directory structure: ${error.message}`,
    );
  }
}

export async function generateAppstream(components) {
  const repoPath = config.repo_name;
  const appstreamPath = path.join(
    repoPath,
    "appstream",
    "x86_64",
    "appstream.xml",
  );

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

  // Write uncompressed XML
  await fs.writeFile(appstreamPath, xml);
  console.log(`✓ Generated appstream.xml with ${components.length} components`);

  // Compress it
  const zlib = await import("zlib");
  const content = await fs.readFile(appstreamPath);
  const compressed = zlib.gzipSync(content);
  await fs.writeFile(appstreamPath + ".gz", compressed);
  console.log(`✓ Compressed to appstream.xml.gz`);
}

export async function createSummary() {
  const repoPath = config.repo_name;

  // Check if there are any refs in the repository
  const refsDir = path.join(repoPath, "refs");
  let hasRefs = false;

  try {
    const entries = await fs.readdir(refsDir, { recursive: true });
    hasRefs = entries.length > 0;
  } catch (error) {
    console.warn("No refs directory found");
  }

  if (!hasRefs) {
    console.log("⚠ No packages pulled yet, creating empty summary");
  }

  // First, update the summary file using flatpak build-update-repo
  // This is the proper way to update a Flatpak repository
  const buildUpdateCommand = `flatpak build-update-repo ${repoPath}`;
  try {
    const { stdout, stderr } = await execAsync(buildUpdateCommand);
    if (stderr && !stderr.includes("warning")) {
      console.warn(`build-update-repo stderr: ${stderr}`);
    }
    console.log(`✓ Updated Flatpak repository (flatpak build-update-repo)`);
  } catch (error) {
    // If flatpak build-update-repo fails, fall back to ostree summary
    console.warn(`⚠ flatpak build-update-repo failed, using ostree summary`);
    await fallbackOstreeSummary();
  }
}

async function fallbackOstreeSummary() {
  const repoPath = config.repo_name;

  // Use basic ostree summary update
  const summaryCommand = `ostree summary -u --repo=${repoPath}`;
  try {
    const { stdout, stderr } = await execAsync(summaryCommand);
    if (stderr && !stderr.includes("warning")) {
      console.warn(`Summary stderr: ${stderr}`);
    }
    console.log(`✓ Updated OSTree summary`);
  } catch (error) {
    throw new Error(`Failed to create summary: ${error.message}`);
  }

  // Add Flatpak-specific metadata manually
  await addFlatpakMetadata();
}

async function addFlatpakMetadata() {
  const repoPath = config.repo_name;

  // Add xa.title metadata to the summary using ostree
  const titleCommand = `ostree summary --repo=${repoPath} --add-metadata xa.title=s:'${config.repo_name}'`;

  try {
    await execAsync(titleCommand);
    console.log("✓ Added repository title metadata");
  } catch (error) {
    console.warn(`Could not add title metadata: ${error.message}`);
  }

  // Add xa.comment metadata
  const commentCommand = `ostree summary --repo=${repoPath} --add-metadata xa.comment=s:'Mirrored Flatpak Repository'`;

  try {
    await execAsync(commentCommand);
    console.log("✓ Added repository comment metadata");
  } catch (error) {
    console.warn(`Could not add comment metadata: ${error.message}`);
  }
}
