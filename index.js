import { mirrorFlatpakLibOnly as mirrorFlatpak } from "./mirror/libflatpakMirror.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

console.log("=== usrpkg-builder ===");
console.log("Flatpak repository mirror tool\n");

// Execute the mirroring process
mirrorFlatpak().catch((error) => {
  console.error("Fatal error during mirroring:", error);
  process.exit(1);
});
