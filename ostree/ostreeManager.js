import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

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

  // First, update the summary file
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

  // Add Flatpak-specific metadata to the summary
  await addFlatpakMetadata();
}

async function addFlatpakMetadata() {
  const repoPath = config.repo_name;

  // Create a minimal appstream metadata file if it doesn't exist
  const appstreamPath = path.join(
    repoPath,
    "appstream",
    "x86_64",
    "appstream.xml.gz",
  );

  try {
    await fs.access(appstreamPath);
  } catch (error) {
    console.log("Creating placeholder appstream metadata...");
    await createPlaceholderAppstream(appstreamPath);
  }

  // Try to use flatpak build-update-repo first
  const updateCommand = `flatpak build-update-repo --no-update-appstream ${repoPath}`;
  try {
    const { stdout, stderr } = await execAsync(updateCommand);
    if (stderr && !stderr.includes("warning")) {
      console.warn(`build-update-repo stderr: ${stderr}`);
    }
    console.log(`✓ Updated Flatpak repository metadata`);
  } catch (error) {
    // If flatpak build-update-repo fails, try adding xa.title to summary manually
    console.warn(
      `⚠ flatpak build-update-repo not available, using fallback method`,
    );
    await addSummaryMetadataManually();
  }
}

async function createPlaceholderAppstream(appstreamPath) {
  const zlib = await import("zlib");
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<components version="0.14">
  <!-- Mirrored Flatpak applications will appear here -->
</components>`;

  const compressed = zlib.gzipSync(Buffer.from(xmlContent));
  await fs.writeFile(appstreamPath, compressed);
}

async function addSummaryMetadataManually() {
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

export async function updateAppstream(appstreamData) {
  const repoPath = config.repo_name;
  const appstreamPath = path.join(
    repoPath,
    "appstream",
    "x86_64",
    "appstream.xml",
  );

  // Write the appstream data (assuming it's XML string)
  await fs.writeFile(appstreamPath, appstreamData);

  // Compress it
  const zlib = await import("zlib");
  const content = await fs.readFile(appstreamPath);
  const compressed = zlib.gzipSync(content);
  await fs.writeFile(appstreamPath + ".gz", compressed);

  console.log("✓ Updated appstream metadata");
}
