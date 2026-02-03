import config from "../utils/config.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as libflatpak from "libflatpak";
import { parseString } from "xml2js";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { createWriteStream, createReadStream } from "fs";
import fetch from "node-fetch";

/**
 * libflatpak-only mirroring tool with workarounds for early binding issues
 *
 * This implementation uses only libflatpak bindings (no CLI), but includes
 * workarounds for known issues in the early development of the bindings.
 */

export async function mirrorFlatpakLibOnly() {
  console.log("=== libflatpak Mirror Tool (Pure Bindings) ===");
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Load configuration
  console.log("Loading configuration...");
  const repoPath = path.resolve(config.repo_path);
  const appstreamUrl = config.appstream_url;
  const architecture = config.architecture;
  const remoteName = config.remote_name;
  const remoteUrl = config.remote_url;

  console.log(`Repository path: ${repoPath}`);
  console.log(`Architecture: ${architecture}`);
  console.log(`Remote: ${remoteName} (${remoteUrl})`);
  console.log(`AppStream URL: ${appstreamUrl}\n`);

  try {
    // Set FLATPAK_USER_DIR to use custom repository location
    // This tells libflatpak to use our custom repository
    process.env.FLATPAK_USER_DIR = repoPath;
    console.log(`Set FLATPAK_USER_DIR=${repoPath}`);

    // Step 1: Ensure repository directory exists and is initialized
    console.log("\nStep 1: Preparing repository directory...");
    await fs.mkdir(repoPath, { recursive: true });

    // Initialize OSTree repository structure if needed
    console.log("Initializing OSTree repository structure...");
    await initializeRepository(repoPath);

    console.log(`✓ Repository directory ready: ${repoPath}\n`);

    // Step 2: Get system installations
    console.log("Step 2: Getting system installations...");
    const installations = libflatpak.getSystemInstallations();

    if (!installations || installations.length === 0) {
      throw new Error(
        "No Flatpak installations found. Please ensure Flatpak is installed.",
      );
    }

    console.log(`✓ Found ${installations.length} installation(s)`);

    // Use the first installation (should be affected by FLATPAK_USER_DIR)
    const installation = installations[0];
    console.log(`  Using installation: ${installation.getId()}`);
    console.log(`  Path: ${installation.getPath()}`);
    console.log(`  Is user installation: ${installation.getIsUser()}\n`);

    // Step 3: Check for existing remotes
    console.log("Step 3: Checking for existing remotes...");
    const remotes = installation.listRemotes();
    console.log(`✓ Found ${remotes.length} remote(s)`);

    // Look for our target remote
    let targetRemote = remotes.find((r) => r.getName() === remoteName);

    if (targetRemote) {
      console.log(`✓ Remote '${remoteName}' already exists`);
      console.log(`  URL: ${targetRemote.getUrl()}`);
      console.log(`  Title: ${targetRemote.getTitle()}`);
    } else {
      console.log(`⚠ Remote '${remoteName}' not found in installation`);
      console.log(`  Attempting to create remote using libflatpak bindings...`);

      try {
        // NOTE: This currently fails with "Expected external object for parameter 'data'"
        // This is a known issue with the early libflatpak bindings
        targetRemote = libflatpak.Remote.create(remoteName);
        targetRemote.setUrl(remoteUrl);
        targetRemote.setTitle("Flathub");
        targetRemote.setComment(
          "The central repository for Flatpak applications",
        );
        targetRemote.setGpgVerify(false); // Disable GPG for mirroring
        targetRemote.setNoenumerate(false);
        targetRemote.setDisabled(false);

        // Try to add remote to installation
        const added = installation.addRemote(targetRemote, false, null);
        if (added) {
          console.log(
            `✓ Remote '${remoteName}' created and added successfully`,
          );
        } else {
          console.log(`⚠ Failed to add remote (may already exist)`);
        }
      } catch (error) {
        console.log(`✗ Failed to create remote via bindings: ${error.message}`);
        console.log(`  This is a known issue with early libflatpak bindings.`);
        console.log(
          `  Workaround: Ensure remote '${remoteName}' exists in system installation.`,
        );
        console.log(
          `  You can add it manually: flatpak remote-add --user --no-gpg-verify ${remoteName} ${remoteUrl}`,
        );
        process.exit(1);
      }
    }

    // Step 4: Update remote metadata if needed
    console.log("\nStep 4: Updating remote metadata...");
    try {
      const updated = installation.updateRemoteSync(remoteName, null);
      if (updated) {
        console.log(`✓ Remote metadata updated for '${remoteName}'`);
      } else {
        console.log(
          `⚠ Remote metadata update returned false (may already be current)`,
        );
      }
    } catch (error) {
      console.log(`⚠ Failed to update remote metadata: ${error.message}`);
      console.log(`  Continuing with existing metadata...`);
    }

    // Step 5: List available packages
    console.log("\nStep 5: Fetching list of available packages...");
    let remoteRefs;
    try {
      remoteRefs = installation.listRemoteRefsSync(remoteName, null);
      console.log(
        `✓ Found ${remoteRefs.length} remote refs from '${remoteName}'`,
      );
    } catch (error) {
      console.log(`✗ Failed to list remote refs: ${error.message}`);
      console.log(
        `  This may indicate the remote needs updating or has no metadata.`,
      );
      process.exit(1);
    }

    // Filter for applications of target architecture
    const packages = remoteRefs.filter((ref) => {
      return (
        ref.getKind() === 0 && // FLATPAK_REF_KIND_APP (applications)
        ref.getArch() === architecture
      );
    });

    console.log(`✓ Found ${packages.length} applications for ${architecture}`);

    // Apply package limit if specified
    let packagesToMirror = packages;
    if (config.max_packages > 0) {
      packagesToMirror = packages.slice(0, config.max_packages);
      console.log(
        `  Limiting to ${config.max_packages} packages for testing\n`,
      );
    } else {
      console.log(`  Will attempt to mirror all ${packages.length} packages\n`);
    }

    // Step 6: Download AppStream metadata for package information
    console.log("Step 6: Downloading AppStream metadata...");
    const appstreamData = await downloadAppStreamData(appstreamUrl);
    console.log(
      `✓ Downloaded AppStream data (${appstreamData.length} components)\n`,
    );

    // Step 7: Mirror packages using libflatpak transactions
    console.log("Step 7: Mirroring packages using libflatpak transactions...");
    const results = await mirrorPackagesLibOnly(
      installation,
      packagesToMirror,
      remoteName,
      architecture,
      appstreamData,
      remoteUrl,
    );

    console.log("\n=== Mirroring Summary ===");
    console.log(`Total packages available: ${packages.length}`);
    console.log(`Packages attempted: ${packagesToMirror.length}`);
    console.log(`Successfully processed: ${results.success}`);
    console.log(`Failed: ${results.failed}`);
    console.log(
      `Skipped (not attempted due to binding issues): ${results.skipped}`,
    );

    if (results.failures.length > 0) {
      console.log("\nFailed packages:");
      results.failures.forEach((failure) => {
        console.log(`  - ${failure.ref}: ${failure.error}`);
      });
    }

    if (results.skipped > 0) {
      console.log(
        "\n⚠ Note: Some packages were not attempted due to libflatpak binding limitations.",
      );
      console.log(
        "  The bindings are in early development and some functions may not work correctly.",
      );
      console.log(
        "  Please report these issues to the libflatpak package maintainer.",
      );
    }

    console.log("\n=== Repository Information ===");
    console.log(`Repository location: ${repoPath}`);
    console.log(`Finished at: ${new Date().toISOString()}`);

    // Provide instructions for using the repository
    console.log("\n=== Usage Instructions ===");
    console.log("To use this repository as a Flatpak remote:");
    console.log(
      `  1. flatpak remote-add --user --no-gpg-verify usrpkg file://${repoPath}`,
    );
    console.log("  2. flatpak install --user usrpkg org.example.App");
    console.log("\nNote: If packages failed to mirror, you may need to:");
    console.log("  - Check libflatpak binding issues");
    console.log("  - Ensure you have sufficient disk space");
    console.log("  - Check network connectivity");
  } catch (error) {
    console.error("\n=== FATAL ERROR ===");
    console.error(`Mirroring failed: ${error.message}`);
    console.error("\n=== Troubleshooting ===");
    console.error("Common issues with libflatpak bindings:");
    console.error(
      '1. Remote.create() may fail with "Expected external object"',
    );
    console.error("2. Transaction.create() may fail with similar errors");
    console.error("3. Some methods may expect different parameter types");
    console.error("\nWorkarounds:");
    console.error("- Ensure the remote exists in the system installation");
    console.error("- Use FLATPAK_USER_DIR to point to existing repository");
    console.error("- Report binding issues to libflatpak package maintainer");
    process.exit(1);
  }
}

/**
 * Mirror packages using only libflatpak bindings
 * Uses Transaction.addInstallFlatpakref() to download packages
 */
async function mirrorPackagesLibOnly(
  installation,
  packages,
  remoteName,
  architecture,
  appstreamData,
  remoteUrl,
) {
  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };

  const totalPackages = packages.length;

  console.log(`Attempting to mirror ${totalPackages} packages...\n`);

  // Create a map of AppStream data for quick lookup
  const appstreamMap = {};
  appstreamData.forEach((component) => {
    const id = component.id?.[0];
    if (id) {
      appstreamMap[id] = component;
    }
  });

  for (let i = 0; i < totalPackages; i++) {
    const pkg = packages[i];
    const packageNumber = i + 1;

    // Get package info from AppStream if available
    const appstreamInfo = appstreamMap[pkg.id];
    const pkgName =
      appstreamInfo?.name?.[0]?._ || appstreamInfo?.name?.[0] || pkg.id;
    const pkgSummary =
      appstreamInfo?.summary?.[0]?._ || appstreamInfo?.summary?.[0] || "";

    console.log(`[${packageNumber}/${totalPackages}] ${pkgName}`);
    if (pkgSummary) {
      console.log(`   ${pkgSummary}`);
    }

    try {
      // Create transaction for this package
      const transaction = libflatpak.Transaction.create(installation, null);

      // Configure transaction for mirroring (download without deploying)
      transaction.setNoInteraction(true);
      transaction.setAutoInstallSdk(false);
      transaction.setNoDeploy(true); // Don't deploy, just download to cache
      transaction.setNoPull(false); // Do pull/download
      transaction.setDefaultArch(architecture);

      // Try to add package using addInstall method if available (preferred)
      let added = false;
      const refString = `${pkg.getName()}/${pkg.getArch()}/${pkg.getBranch()}`;

      if (typeof transaction.addInstall === "function") {
        // Use addInstall with remote name and ref string
        added = transaction.addInstall(remoteName, refString);
        if (!added) {
          console.log(`   ⚠ addInstall failed, trying flatpakref approach...`);
        }
      }

      // If addInstall not available or failed, try flatpakref approach
      if (!added) {
        // Create improved flatpakref data for the package
        // For Flathub, .flatpakref files might be available at:
        // https://dl.flathub.org/repo/appstream/${pkg.getArch()}/${pkg.getName()}.flatpakref
        // But we'll create a synthetic one that should work with repository
        const flatpakrefContent = `[Flatpak Ref]
Name=${pkg.getName()}
Branch=${pkg.getBranch()}
Arch=${pkg.getArch()}
IsRuntime=${pkg.getKind() === 1}
RuntimeRepo=${remoteUrl}
Title=${pkgName || pkg.getName()}
GpgKey=
GpgVerify=false
`;

        const flatpakrefData = Buffer.from(flatpakrefContent, "utf8");

        // Add package to transaction via flatpakref
        added = transaction.addInstallFlatpakref(flatpakrefData);
        if (!added) {
          throw new Error("Failed to add package to transaction");
        }
      }

      // Run transaction to download package
      const success = transaction.run(null);

      if (success) {
        console.log(`   ✓ Successfully downloaded to repository cache`);
        results.success++;
      } else {
        throw new Error("Transaction run failed (returned false)");
      }
    } catch (error) {
      // Check if this is a known binding issue
      if (
        error.message.includes("Expected external object") ||
        error.message.includes("Expected external object or null")
      ) {
        console.log(`   ✗ Known libflatpak binding issue: ${error.message}`);
        console.log(
          `   This may indicate the binding expects a different parameter type.`,
        );

        results.skipped++;
        results.failures.push({
          ref: `${pkg.getName()}/${pkg.getArch()}/${pkg.getBranch()}`,
          error: `Binding issue: ${error.message}`,
        });
      } else {
        console.log(`   ✗ Failed to download: ${error.message}`);
        results.failed++;
        results.failures.push({
          ref: `${pkg.getName()}/${pkg.getArch()}/${pkg.getBranch()}`,
          error: error.message,
        });
      }
    }

    // Small delay between packages
    if (i < totalPackages - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Download and parse AppStream data
 */
async function downloadAppStreamData(appstreamUrl) {
  try {
    console.log(`Downloading AppStream data from: ${appstreamUrl}`);

    const response = await fetch(appstreamUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download AppStream: ${response.status} ${response.statusText}`,
      );
    }

    // Create temporary file for gzipped data
    const tempGzPath = "/tmp/appstream.xml.gz";
    const tempXmlPath = "/tmp/appstream.xml";

    const fileStream = createWriteStream(tempGzPath);
    await pipeline(response.body, fileStream);

    // Decompress gzipped file
    await pipeline(
      createReadStream(tempGzPath),
      createGunzip(),
      createWriteStream(tempXmlPath),
    );

    // Read and parse XML
    const xmlData = await fs.readFile(tempXmlPath, "utf-8");

    return new Promise((resolve, reject) => {
      parseString(xmlData, (err, result) => {
        if (err) {
          reject(err);
          return;
        }

        // Extract components from AppStream data
        const components = result?.components?.component || [];
        console.log(`Parsed ${components.length} AppStream components`);
        resolve(components);
      });
    });
  } catch (error) {
    console.log(`Warning: Failed to download AppStream data: ${error.message}`);
    console.log("Continuing without AppStream metadata...");
    return [];
  }
}

/**
 * Get repository information using libflatpak
 */
async function getRepositoryInfo(installation) {
  try {
    const remotes = installation.listRemotes();
    const installedRefs = installation.listInstalledRefs();

    return {
      remotes: remotes.map((remote) => ({
        name: remote.getName(),
        url: remote.getUrl(),
        title: remote.getTitle(),
      })),
      installedCount: installedRefs.length,
      installedApps: installedRefs.filter((ref) => ref.getKind() === 0).length,
      installedRuntimes: installedRefs.filter((ref) => ref.getKind() === 1)
        .length,
    };
  } catch (error) {
    console.log(`Warning: Could not get repository info: ${error.message}`);
    return null;
  }
}

/**
 * Check if libflatpak bindings are working properly
 */
/**
 * Initialize OSTree repository structure
 */
async function initializeRepository(repoPath) {
  try {
    // Check if repository already exists (has config file)
    const configPath = path.join(repoPath, "config");
    try {
      await fs.access(configPath);
      console.log("  Using existing OSTree repository");
      return;
    } catch {
      // Repository doesn't exist, create it
    }

    // Create basic OSTree repository structure
    const configContent = `[core]
repo_version=1
mode=bare-user
`;

    await fs.writeFile(configPath, configContent);

    // Create required subdirectories
    const dirs = ["objects", "refs", "state", "tmp"];
    for (const dir of dirs) {
      await fs.mkdir(path.join(repoPath, dir), { recursive: true });
    }

    // Create initial summary file
    const summaryPath = path.join(repoPath, "summary");
    const summaryContent = `[Flatpak Repository]
Title=Local Flatpak Mirror
Description=Mirror created by usrpkg-builder
Version=1
DefaultBranch=stable
`;

    await fs.writeFile(summaryPath, summaryContent);

    console.log(`  Created OSTree repository structure at ${repoPath}`);
  } catch (error) {
    console.error(`  Failed to initialize repository: ${error.message}`);
    throw new Error(`Repository initialization failed: ${error.message}`);
  }
}

export function checkLibFlatpakBindings() {
  console.log("=== libflatpak Binding Check ===\n");

  const issues = [];

  try {
    // Test basic functions
    const arch = libflatpak.getDefaultArch();
    console.log(`✓ getDefaultArch(): ${arch}`);
  } catch (error) {
    issues.push(`getDefaultArch failed: ${error.message}`);
  }

  try {
    const installations = libflatpak.getSystemInstallations();
    console.log(
      `✓ getSystemInstallations(): ${installations?.length || 0} installations`,
    );
  } catch (error) {
    issues.push(`getSystemInstallations failed: ${error.message}`);
  }

  // Test Remote.create (known to have issues)
  try {
    // This is expected to fail in current bindings
    const remote = libflatpak.Remote.create("test-remote");
    console.log(`✓ Remote.create(): Works (unexpected!)`);
  } catch (error) {
    console.log(`⚠ Remote.create(): ${error.message} (expected issue)`);
    issues.push(`Remote.create expects different parameter type`);
  }

  // Test Transaction.create (known to have issues)
  try {
    const installations = libflatpak.getSystemInstallations();
    if (installations && installations.length > 0) {
      // This is expected to fail in current bindings
      const transaction = libflatpak.Transaction.create(installations[0], null);
      console.log(`✓ Transaction.create(): Works (unexpected!)`);
    }
  } catch (error) {
    console.log(`⚠ Transaction.create(): ${error.message} (expected issue)`);
    issues.push(`Transaction.create expects different parameter type`);
  }

  if (issues.length > 0) {
    console.log("\n=== Binding Issues Found ===");
    issues.forEach((issue) => console.log(`  - ${issue}`));
    console.log(
      "\nThese issues need to be fixed in the libflatpak native bindings.",
    );
    console.log("Please report them to the package maintainer.");
  } else {
    console.log("\n✓ All bindings appear to be working correctly!");
  }

  return issues.length === 0;
}

// Export main function
export default {
  mirrorFlatpakLibOnly,
  checkLibFlatpakBindings,
};

// If this script is run directly, execute the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  mirrorFlatpakLibOnly().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}
