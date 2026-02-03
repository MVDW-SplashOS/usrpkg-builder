import { exec } from "child_process";
import { promisify } from "util";
import config from "../utils/config.js";

const execAsync = promisify(exec);

export async function fetchPackage(repo, app) {
  const command = `ostree pull --repo=${config.repo_name} ${repo} ${app}`;

  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      console.warn(`Command stderr: ${stderr}`);
    }
    return stdout;
  } catch (error) {
    throw new Error(`Failed to run ostree pull: ${error.message}`);
  }
}
