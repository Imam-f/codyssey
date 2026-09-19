import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const result = JSON.parse(
  execFileSync(
    "uv",
    ["run", "--no-project", "--script", "backend/analyzer.py", "sample"],
    { encoding: "utf8", windowsHide: true },
  ),
);
result.root = "Bundled example";
mkdirSync("public", { recursive: true });
writeFileSync("public/sample-index.json", JSON.stringify(result));
