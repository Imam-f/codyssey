# Codyssey

**v0.1.0** · [MIT License](LICENSE)

> A developer tool where you anger the gods and commit atrocities against humanity

A compact Electron desktop app for inspecting Python repositories. The interface is read-only: a file explorer and outline, Tree-sitter source viewer, function-level usage table, symbol inspector, class inheritance graph, class member tracker, and call graph.

## Run

Requires Node.js 22.12+ and [uv](https://docs.astral.sh/uv/getting-started/installation/) on PATH. `uv` selects or installs Python 3.12+ for the analyzer; no Python packages are required.

```sh
npm install
npm run dev
```

The app starts on a welcome page with no repository loaded. Choose **Open repository**, or press **Ctrl+O**, to open a local folder. **Explore the sample** loads the bundled example when you want a quick tour.

The welcome page keeps your ten most recently opened repositories across restarts. Click one to reopen and reindex it, or use its × button to remove it from the list. The home button closes the current repository and returns to the welcome page. The bundled sample is not added to the recent list.

```sh
npm run build     # Build the renderer and bundled browser example
npm start         # Run the production Electron app
npm test          # Python semantic analysis tests, through uv
npm run test:ui   # Integration tests against the production Electron app
npm run test:definitions  # Cross-file definition navigation tests
npm run test:welcome      # Welcome, persistent recents, and VS Code integration tests
npm run pack      # Unpacked desktop application under release/
```

The packaged application also requires `uv` on PATH. All highlighting assets are bundled locally. `npm run dev:web` provides a browser preview with an explicit sample action after `npm run sample`; local folders, persistent recent repositories, and VS Code integration require Electron.

## Navigation

- **Open in VS Code** (the toolbar's **VS Code** button) opens the current repository in a new Visual Studio Code window using its `vscode://` handler, preserving workspaces already open in other windows. Visual Studio Code must be installed with that handler enabled.

- Click a source identifier to inspect its declaration, type, and usages. Matching occurrences are highlighted. **Ctrl+click**, double-click, or **F12** follows its definition, including imports, package re-exports, qualified module members, and statically known methods in other indexed files. The inspector keeps the local import declaration and shows a separate definition link. Back restores the original source location. Unresolved targets show a message rather than jumping to another symbol.
- Follow a type link in the inspector, or press **Ctrl+F12**, to open its indexed definition. Built-in and unresolved external types have no definition link.
- The **Current function** checkbox limits variables and usages to the function under the current source line. Turn it off to inspect the whole file. Nested functions retain separate scopes.
- **Aliases** shows import aliases and assignment chains, their scopes, source lines, and reassignment boundaries. Target links navigate to indexed symbols.
- **Inheritance** shows repository classes, multiple inheritance, and unresolved external bases. Search narrows to a class and its ancestors/descendants. Click a class to open its declaration, or use its crosshair to focus the hierarchy. Zoom and scroll to explore large graphs.
- **Class tracker** lists every repository class and, for the selected class, its bases and metrics, with methods and properties grouped by whether they are added, overridden, inherited, or dynamically assigned. Instance properties first assigned by methods other than `__init__` are flagged as dynamic. Search by class or member name; each member links to its declaration.
- **Call graph** shows the selected function between its direct **Called by** and **Calls** neighbors. Search functions, follow a node to refocus, filter either direction, or hide unresolved targets. Definition buttons open source; line-number buttons open the exact call site. Repeated calls share an edge with separate call-site links, and recursion is marked explicitly. The inspector also lists calls and callers for the selected function or the function containing the selected variable.
- **Ctrl+P** searches files, classes, functions, and type aliases. **Ctrl+F** filters the variable/symbol table by name or type.
- **F5** reindexes the current repository after external changes. Back/forward buttons navigate source history. The download button exports the complete index, including source code, as JSON.

## Analysis

The analyzer is `backend/analyzer.py`, a dependency-free Python AST indexer run through `uv run --no-project --script`. It never imports or executes the analyzed repository. Analysis is a four-stage pipeline, one stage per backend module:

1. **Index** (`analyzer.py`) — parse every file with `ast` and record symbols, references, aliases, classes, and scopes.
2. **Link** (`definitions.py`) — resolve identifiers to indexed definitions across files, imports, re-exports, and inheritance.
3. **Class tracking** (`class_tracker.py`) — classify each class's methods and properties as added, overridden, inherited, or dynamic.
4. **Call graph** (`callgraph.py`) — resolve explicit call sites into a static caller/callee graph.

### Indexing model

For each `.py`/`.pyi` file the indexer produces:

- `symbols` — declared names, each with `kind`, `scopeId`, `scopeName`, `type`, `typeSource`, `path`, `line`/`column`, and a resolved `references` count.
- `references` — every name and attribute occurrence with a `role`, a source location, an optional `expression` (attribute receivers), and a resolved `symbolId` / `definition`.
- `aliases` — import and assignment chains (see below).
- `classes` — class symbols plus `bases`, resolved `baseIds`, a `methods` list, and a `memberTracker` grouping added, overridden, inherited, and dynamic members.
- `scopes` — module/class/function/comprehension scopes with their `globals` and `nonlocals` sets.
- `imports`, `calls`, `assignments` — raw facts consumed by the linking and call-graph stages.

### Symbol kinds

| Kind        | Produced by                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `variable`  | assignment targets (`x = …`, augmented, walrus, destructuring, `except … as`, `match` bindings) |
| `parameter` | function/lambda arguments                                                                       |
| `function`  | `def` and `async def`                                                                           |
| `class`     | `class` declarations                                                                            |
| `import`    | `import` / `from … import …` names (including `as` aliases)                                     |
| `type`      | `type X = …` statements and `X: TypeAlias = …` annotations                                      |

### References and roles

Every occurrence is classified with a `role`:

- `declaration` — the binding site of a symbol.
- `read` / `write` / `delete` — value use, assignment, and `del` targets.
- `call` — the callee expression of a call (`f()` records `f`; `a.f()` records the `f` attribute).
- `type` — identifiers appearing inside an annotation (tracked via an annotation-depth counter).
- `import` — names introduced or referenced by import statements, including dotted sub-tokens with per-token positions.

Attribute access (`a.b`) records the whole `a.b` expression against the receiver's usage; the column is corrected from AST UTF-8 byte offsets to UTF-16 so highlighting aligns with the Tree-sitter renderer.

### Scope and name resolution

- Lexical scopes for module, class, function, lambda, and comprehension bodies; each scope tracks its `parent`.
- `global` and `nonlocal` declarations are collected across a whole block before visiting it, so they apply throughout the body. `binding_scope` routes writes to the declared enclosing scope.
- Comprehensions get their own scope but do not close over class bindings; methods likewise skip class scope (class scope is not a method closure).
- Destructuring targets (`a, b = …`), augmented assignment, walrus (`:=`, bound in the nearest non-comprehension scope), `except … as`, and `match` pattern bindings (`as`, `*rest`, mapping `**rest`) all bind symbols.
- Deletes are recorded as `delete` references.

### Type inference

`typeSource` marks how each symbol's `type` was obtained: `annotation`, `inferred`, or `unknown`. Inference is deliberately narrow:

- Literals infer their Python type name (`str`, `int`, `float`, `bool`, `None`, …).
- Collection expressions infer `list` / `dict` / `set` / `tuple` (including comprehensions).
- A call whose function is a Capitalized name is a constructor-like hint and records the class name.
- Explicit annotations are unparsed source text; `typeTargets` resolves the class/type names inside them to indexed symbol ids. Quoted forward annotations (`"User"`) are stripped and navigable, but identifiers inside a quoted string are not counted as references.

### Aliases

Import and assignment aliases form source-order chains:

- `import` aliases cover `import pkg.mod as m`, `from .mod import X as Y`, and qualified multi-part imports.
- `assignment` aliases cover `A = B`, `Chain = Alias`, etc.
- Each alias records its `scopeId`, `line`, and an `endLine` — the line where a later import or assignment rebinds the name (a static snapshot, not path-sensitive).
- `chain` is the resolved sequence of names (`Chain → Alias → B → .base.Base`) and `targetId` links the final target to an indexed symbol when resolvable.
- Wildcard imports (`from m import *`) are skipped.

### Classes and inheritance

- `bases` are unparsed expressions; `baseIds` resolve them through imports, aliases, and exports.
- Multiple inheritance is supported; the C3 MRO used by call/definition resolution detects cycles and unresolved bases.
- Unresolved external bases are explicitly marked (rendered as `external / unresolved` in the graph).
- The inheritance graph shows all repository classes with ancestry/descendant filtering and per-class method counts.

### Class member tracking

`class_tracker.py` attaches a `memberTracker` to every class, classifying its members as **added**, **overridden**, **inherited**, or **dynamic**:

- Methods defined in the class body are tracked as `method`; `@property` / `@cached_property` / `@setter` / `@deleter` / `@getter` decorated functions become `property`.
- Class-level assignments (plain names in the class body) are recorded as `property` class attributes.
- Instance fields written as `self.x = …` (the first parameter of a method, except `staticmethod`/`classmethod`) are recorded as `property` with their exact assignment location. Fields assigned in `__init__` are stable; fields written only in other methods are flagged `dynamic`.
- Inherited members are collected through the C3 MRO — the first ancestor to define a name wins, and each inherited member records its `inheritedFrom` owner.
- A class's own member is `overridden` when the name also exists on an ancestor, otherwise `added`.

The Class tracker view lists all repository classes with search, and shows the selected class's bases and metrics (local, overridden, inherited, dynamic) grouped into Added/Overridden/Inherited methods and properties, plus Dynamic properties. Every member links to its declaration.

### Definition resolution

`definitions.py` attaches a `definition` to every reference and symbol so identifiers jump to their declaration. Resolution covers:

- Local bindings, parameters, and shadowing, honoring `global`/`nonlocal` and comprehension/class scoping rules.
- Imported functions, classes, and constants, back to their original module and line — including the original `as` token.
- Qualified access (`m.run()`, `pkg.lib.LIMIT`) and module navigation (`import pkg` → `pkg/__init__.py`).
- Indexed import re-exports and `src/`-layout stripping (`src.pkg.mod` ⇄ `pkg.mod`).
- Package re-exports (`from pkg import X` where `pkg` re-exports `X`) and dotted access through a re-exported module or class.
- Inherited members via MRO, `super()` (zero-argument), bound methods (`callback = self.repo.save`), and instance fields assigned in `__init__` (reported with their exact assignment location).
- Reassigned imports degrade to a local `variable` definition; cyclic re-exports and external imports are left unresolved rather than guessed.

### Call graph

The call graph (`callgraph.py`) is built from explicit call sites, producing `nodes` (functions with qualified labels, class constructors, module/class-body contexts, and unresolved external targets), `edges`, and per-site `sites`. Resolution covers:

- Direct, recursive, and repeated calls (one edge with multiple call-site links), nested and `async` functions.
- Imported module/function aliases, indexed import re-exports, and assignment aliases (snapshot semantics).
- Typed receivers from annotations (`def run(repo: Repo) → repo.save()`), constructor-created objects, and `self`/`cls`.
- Inherited methods through MRO, zero-argument `super()`, and fields assigned in `__init__`.
- Constructor calls link to the indexed `__init__` when available; `classmethod`/`staticmethod` receivers are distinguished.
- Caller attribution: calls in comprehensions bubble to the enclosing function; module/class-body calls and function defaults are attributed to their enclosing execution context rather than a function body.

Resolution is conservative and not path-sensitive or interprocedural: callbacks, runtime dispatch, rebound fields, decorators that replace a function, generic/union receiver types, and container annotations (`list[User]` does not dispatch to `User`) remain unresolved or differ at runtime. Caller lists contain resolved indexed sites only; “no indexed callers” does not prove a function is unused.

### Diagnostics and limits

- Syntax errors are reported per file (path, line, message) without stopping the scan.
- Symbolic links and files over 2 MB are skipped; the index is capped at 5,000 Python files and the desktop response at 100 MB.
- Common environment, dependency, cache, and build directories are excluded (`.git`, `.venv`, `venv`, `env`, `__pycache__`, `node_modules`, `dist`, `build`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `site-packages`).
- Python source encodings are respected via `tokenize.open`.
- Reindexing is manual (`F5`); repositories are not watched automatically.

### What it does not do

This is a static browser, not a Python type checker or interpreter. It does not execute code, follow dynamic attributes, monkey-patching, arbitrary factories, or runtime-dependent control flow, nor does it infer every attribute/method target. Alias chains are source-order snapshots. The call graph describes explicit call sites, not implicit decorator invocation or a runtime trace.

## Structure

- `backend/analyzer.py` — dependency-free Python AST indexer, invoked only through `uv run --no-project --script`.
- `backend/callgraph.py` — static call resolution and graph nodes, edges, and individual call sites.
- `backend/definitions.py` — cross-file source definition links, including relative imports, package re-exports, and `src/` layouts.
- `backend/class_tracker.py` — per-class member classification (added, overridden, inherited, dynamic).
- `test/test_analyzer.py` — Python semantic analysis tests, run via `npm test` through `uv`.
- `electron/` — sandboxed window, narrow context bridge, directory/export dialogs, and analysis process.
- `src/` — React interface and Tree-sitter WASM syntax queries, organized into `components/`.
- `test/sample/` — small Python repository exercising navigation, aliases, inheritance, and class tracking; bundled into the desktop app as a demo.
- `test/sample.mjs` — generates the bundled browser example index (`npm run sample`).
- `test/smoke.mjs` — production Electron integration tests and screenshots in `artifacts/`.
- `test/definitions-smoke.mjs` — cross-file definition navigation tests through the production UI (`npm run test:definitions`).
- `test/welcome-smoke.mjs` — welcome page, persistent recent repositories, and VS Code integration tests (`npm run test:welcome`).
- `scripts/` — development launcher and bundled asset setup.

The implementation follows the [Tree-sitter web bindings](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md) and [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) documentation.

## License

Codyssey is released under the [MIT License](LICENSE).
