# Codyssey

> A developer tool where you anger the gods and commit atrocities against humanity

A compact Electron desktop app for inspecting Python repositories. The interface is read-only: a file explorer and outline, Tree-sitter source viewer, function-level usage table, symbol inspector, and class inheritance graph.

## Run

Requires Node.js 22.12+ and [uv](https://docs.astral.sh/uv/getting-started/installation/) on PATH. `uv` selects or installs Python 3.12+ for the analyzer; no Python packages are required.

```sh
npm install
npm run dev
```

The app starts with a bundled example repository. Click the folder name in the toolbar, or press **Ctrl+O**, to open a local folder.

```sh
npm run build     # Build the renderer and bundled browser example
npm start         # Run the production Electron app
npm test          # Python semantic analysis tests, through uv
npm run test:ui   # Integration tests against the production Electron app
npm run pack      # Unpacked desktop application under release/
```

The packaged application also requires `uv` on PATH. All highlighting assets are bundled locally. `npm run dev:web` provides a browser preview of the example after `npm run sample`; local-folder selection requires Electron.

## Navigation

- Click a source identifier to inspect its declaration, type, and usages. Matching occurrences are highlighted. Double-click or **F12** to jump to the declaration.
- Follow a type link in the inspector, or press **Ctrl+F12**, to open its indexed definition. Built-in and unresolved external types have no definition link.
- The **Current function** checkbox limits variables and usages to the function under the current source line. Turn it off to inspect the whole file. Nested functions retain separate scopes.
- **Aliases** shows import aliases and assignment chains, their scopes, source lines, and reassignment boundaries. Target links navigate to indexed symbols.
- **Inheritance** shows repository classes, multiple inheritance, and unresolved external bases. Search narrows to a class and its ancestors/descendants. Click a class to open its declaration, or use its crosshair to focus the hierarchy. Zoom and scroll to explore large graphs.
- **Call graph** shows the selected function between its direct **Called by** and **Calls** neighbors. Search functions, follow a node to refocus, filter either direction, or hide unresolved targets. Definition buttons open source; line-number buttons open the exact call site. Repeated calls share an edge with separate call-site links, and recursion is marked explicitly. The inspector also lists calls and callers for the selected function or the function containing the selected variable.
- **Ctrl+P** searches files, classes, functions, and type aliases. **Ctrl+F** filters the variable/symbol table by name or type.
- **F5** reindexes the current repository after external changes. Back/forward buttons navigate source history. The download button exports the complete index, including source code, as JSON.

## Analysis scope

The analyzer parses files with Python's standard `ast` module and never imports or runs the repository. It indexes parameters, assignments, classes, functions, imports, modern `type` aliases and `TypeAlias` declarations, annotation references, reads, writes, calls, and deletes. Scope handling includes closures, `global`, `nonlocal`, comprehensions, lambdas, destructuring, and pattern bindings. Import and assignment aliases connect type annotations and base classes across indexed files.

This is a static browser, not a full Python type checker. Type inference is limited to literals, collection expressions, and constructor-like calls. Dynamic attributes, monkey-patching, wildcard imports, import re-exports, arbitrary factories, and runtime-dependent control flow are not fully resolved. Attribute access records the receiver's usage; it does not infer every attribute or method target. Alias chains are source-order snapshots and are not path-sensitive. Unresolved inheritance bases are explicitly marked. Quoted forward annotations can navigate to a type but are not counted as identifier references inside the quoted string.

Syntax errors are reported per file without stopping the repository scan. Files over 2 MB and symbolic links are skipped; the index is capped at 5,000 Python files and the desktop response at 100 MB. Common environment, dependency, cache, and build directories are excluded. Python source encodings are respected. Reindexing is manual; repositories are not watched automatically.

Call resolution covers direct and recursive calls, nested/async functions, imported module/function aliases, indexed import re-exports, assignment aliases, typed receivers, constructor-created objects, `self`/`cls`, inherited methods, zero-argument `super()`, and fields assigned in `__init__` from a known receiver. Constructor calls link to the indexed initializer when available. Module/class-body calls and function defaults are attributed to their enclosing execution context. The graph describes explicit call sites, not implicit decorator invocation or a runtime trace. It is not path-sensitive or interprocedural: callbacks, runtime dispatch, rebound fields, decorators that replace functions, generic/union receiver types, and other dynamic targets may remain unresolved or differ at runtime. Caller lists include resolved indexed sites only; “no indexed callers” does not prove a function is unused.

## Structure

- `backend/analyzer.py` — dependency-free Python AST indexer, invoked only through `uv run --no-project --script`.
- `backend/callgraph.py` — static call resolution and graph nodes, edges, and individual call sites.
- `electron/` — sandboxed window, narrow context bridge, directory/export dialogs, and analysis process.
- `src/` — React interface and Tree-sitter WASM syntax queries.
- `sample/` — small Python repository exercising navigation, aliases, and inheritance.
- `scripts/smoke.mjs` — production Electron integration tests and screenshots in `artifacts/`.

The implementation follows the [Tree-sitter web bindings](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md) and [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) documentation.
