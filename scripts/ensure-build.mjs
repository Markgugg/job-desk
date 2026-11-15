// Runs before `npm start`: builds the dashboard once if dist/ is missing.
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

if (!existsSync(new URL("../dist/index.html", import.meta.url))) {
  console.log("No build found. Building the dashboard first…");
  execSync("npm run build", { stdio: "inherit" });
}
