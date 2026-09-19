import { Box, Braces, ArrowUpRight, Variable } from "lucide-react";
import { version } from "../package.json";

export const appVersion = version;
export const isDesktop = Boolean(window.codyssey);

export const Icon = ({ kind, size = 13 }) =>
  kind === "class" ? (
    <Box size={size} />
  ) : kind === "function" ? (
    <Braces size={size} />
  ) : kind === "import" ? (
    <ArrowUpRight size={size} />
  ) : (
    <Variable size={size} />
  );

export const basename = (path) => path.split("/").pop();

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const api = window.codyssey || {
  sample: () =>
    fetch("./sample-index.json").then((r) => {
      if (!r.ok)
        throw new Error("Sample index unavailable. Run npm run sample.");
      return r.json();
    }),
  open: async () => {
    throw new Error(
      "Open the Electron desktop app with npm run dev to choose a local repository.",
    );
  },
  refresh: () => api.sample(),
  recent: async () => [],
  openRecent: async () => api.open(),
  removeRecent: async () => [],
  close: async () => {},
  openInVSCode: async () => {
    throw new Error("Open in VS Code is available in the Electron desktop app.");
  },
  export: async (data) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([data], { type: "application/json" }),
    );
    a.download = "codyssey-analysis.json";
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  },
};
