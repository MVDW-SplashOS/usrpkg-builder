import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";

import config from "../utils/config.js";

const execAsync = promisify(exec);

export async function initRepo() {
  try {
    await fs.access(config.repo_name);
  } catch (error) {
    // Repository does not exist, proceed with initialization
    const command = `ostree init --repo=${config.repo_name} --mode=archive-z2`;

    try {
      const { stderr } = await execAsync(command);
      if (stderr) {
        console.warn(`Command stderr: ${stderr}`);
      }
    } catch (error) {
      throw new Error(`Failed to run ostree init: ${error.message}`);
    }
  }

  if (config.repo_remotes && Array.isArray(config.repo_remotes)) {
    for (const remote of config.repo_remotes) {
      const checkRemoteCommand = `ostree remote list --repo=${config.repo_name}`;
      try {
        const { stdout } = await execAsync(checkRemoteCommand);
        if (stdout.includes(remote.name)) {
          continue;
        }
      } catch (error) {}

      const addRemoteCommand = `ostree remote add --repo=${config.repo_name} --no-gpg-verify ${remote.name} ${remote.url}`;
      try {
        const { stderr } = await execAsync(addRemoteCommand);
        if (stderr) {
          console.warn(`Command stderr for remote ${remote.name}: ${stderr}`);
        }
        console.log(`Added remote: ${remote.name}`);
      } catch (error) {
        throw new Error(
          `Failed to add remote ${remote.name}: ${error.message}`,
        );
      }
    }
  }
}
