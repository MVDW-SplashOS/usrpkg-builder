import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import config from "../utils/config.js";

const execAsync = promisify(exec);

/**
 * Recursively find files in a directory that match a predicate.
 */
async function findFilesRecursive(dir, predicate) {
  const results = [];

  async function scan(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && predicate(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  await scan(dir);
  return results;
}

/**
 * Find the mirrored ref file for a given app reference.
 * Returns the full path to the file, or null if not found.
 */
async function findMirroredRefFile(repoPath, app) {
  const mirrorsDir = path.join(repoPath, "refs/mirrors");

  try {
    await fs.access(mirrorsDir);
  } catch (error) {
    // Mirrors directory doesn't exist
    return null;
  }

  // Use recursive search to find files that match the app path
  const files = await findFilesRecursive(mirrorsDir, (filePath) => {
    const relative = path.relative(mirrorsDir, filePath);
    return (
      relative.endsWith(app) || relative.includes(app.replace(/\//g, path.sep))
    );
  });

  if (files.length > 0) {
    return files[0];
  }

  return null;
}

/**
 * Attempt to clean up mirrored refs for a given app.
 */
async function cleanupMirroredRefs(repoPath, repo, app) {
  // List of possible mirrored ref paths
  const possibleMirrorPaths = [
    // With collection ID (e.g., org.flathub.Stable)
    `refs/mirrors/org.${repo}.Stable/${app}`,
    `refs/mirrors/${repo}.Stable/${app}`,
    `refs/mirrors/${repo}/${app}`,
    // Direct ref (older format)
    `${repo}:${app}`,
  ];

  // Delete mirrored ref files
  for (const mirrorPath of possibleMirrorPaths) {
    if (mirrorPath.includes("refs/mirrors/")) {
      const fullPath = path.join(repoPath, mirrorPath);
      try {
        await fs.unlink(fullPath);
        console.log(`  ✓ Cleaned mirrored ref: ${mirrorPath}`);
      } catch (error) {
        // Ignore errors if file doesn't exist
      }
    }
  }

  // Also try to delete using ostree refs command for any remaining refs
  try {
    await execAsync(`ostree refs --repo=${repoPath} --delete ${repo}:${app}`);
  } catch (error) {
    // Ignore errors if ref doesn't exist
  }
}

/**
 * Fetch a package from a remote repository and create a local ref.
 */
export async function fetchPackage(repo, app) {
  const repoPath = config.repo_name;

  // Use --mirror mode to pull the ref
  const pullCommand = `ostree pull --repo=${repoPath} --mirror ${repo} ${app}`;

  try {
    const { stdout, stderr } = await execAsync(pullCommand);
    if (stderr && !stderr.includes("Receiving")) {
      console.warn(`Pull stderr: ${stderr}`);
    }

    const localRef = app;
    let commit = null;

    // First, try to find the mirrored ref file by scanning mirrors directory
    const mirroredRefPath = await findMirroredRefFile(repoPath, app);
    if (mirroredRefPath) {
      commit = (await fs.readFile(mirroredRefPath, "utf8")).trim();
      console.log(
        `  Found mirrored ref at ${path.relative(repoPath, mirroredRefPath)}: ${commit.substring(0, 8)}`,
      );
    } else {
      // Fallback: try known paths
      const knownPaths = [
        `refs/mirrors/org.${repo}.Stable/${app}`,
        `refs/mirrors/${repo}.Stable/${app}`,
        `refs/mirrors/${repo}/${app}`,
        `${repo}:${app}`,
      ];

      for (const knownPath of knownPaths) {
        const fullPath = path.join(repoPath, knownPath);
        try {
          const stats = await fs.stat(fullPath);
          if (stats.isFile()) {
            commit = (await fs.readFile(fullPath, "utf8")).trim();
            console.log(
              `  Found mirrored ref at ${knownPath}: ${commit.substring(0, 8)}`,
            );
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }

    // If still not found, try using ostree rev-parse
    if (!commit) {
      for (const refSpec of [`${repo}:${app}`, app]) {
        try {
          const { stdout: commitHash } = await execAsync(
            `ostree rev-parse --repo=${repoPath} ${refSpec}`,
          );
          commit = commitHash.trim();
          console.log(
            `  Found ref via rev-parse: ${refSpec} → ${commit.substring(0, 8)}`,
          );
          break;
        } catch (error) {
          continue;
        }
      }
    }

    if (!commit) {
      console.warn(`  ⚠ Could not find commit for ${app} after pull`);
      return stdout;
    }

    // Create or update local ref pointing to the same commit
    await execAsync(
      `ostree refs --repo=${repoPath} --create=${localRef} ${commit} --force`,
    );
    console.log(
      `  ✓ Created/updated local ref: ${localRef} → ${commit.substring(0, 8)}`,
    );

    // Clean up mirrored refs
    await cleanupMirroredRefs(repoPath, repo, app);

    return stdout;
  } catch (error) {
    throw new Error(`Failed to run ostree pull: ${error.message}`);
  }
}
