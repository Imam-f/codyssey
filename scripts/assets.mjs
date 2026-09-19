import { mkdir, copyFile } from "node:fs/promises";
await mkdir("public", { recursive: true });
await copyFile(
  "node_modules/web-tree-sitter/tree-sitter.wasm",
  "public/web-tree-sitter.wasm",
);
await copyFile(
  "node_modules/tree-sitter-python/tree-sitter-python.wasm",
  "public/tree-sitter-python.wasm",
);
