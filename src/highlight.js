import { Parser, Language, Query } from "web-tree-sitter";

let initializing;
export function initHighlighter() {
  if (!initializing)
    initializing = (async () => {
      await Parser.init({
        locateFile: () =>
          new URL("web-tree-sitter.wasm", document.baseURI).href,
      });
      const language = await Language.load(
        new URL("tree-sitter-python.wasm", document.baseURI).href,
      );
      const parser = new Parser();
      parser.setLanguage(language);
      const query = new Query(
        language,
        `
      (identifier) @variable
      (comment) @comment
      (string) @string
      (integer) @number
      (float) @number
      (true) @constant
      (false) @constant
      (none) @constant
      (function_definition name: (identifier) @function)
      (class_definition name: (identifier) @type)
      (call function: (identifier) @function)
      (attribute attribute: (identifier) @property)
      (type (identifier) @type)
      ["def" "class" "return" "if" "else" "elif" "for" "while" "in" "not" "and" "or" "is" "import" "from" "as" "with" "try" "except" "finally" "raise" "pass" "break" "continue" "lambda" "yield" "async" "await" "global" "nonlocal" "assert" "del"] @keyword
    `,
      );
      return (source) => {
        const tree = parser.parse(source);
        const captures = query.captures(tree.rootNode);
        const tokens = [];
        const priority = {
          variable: 0,
          property: 1,
          function: 2,
          type: 3,
          keyword: 4,
          number: 4,
          constant: 4,
          string: 5,
          comment: 6,
        };
        for (const capture of captures) {
          const { node, name } = capture;
          for (
            let row = node.startPosition.row;
            row <= node.endPosition.row;
            row++
          ) {
            (tokens[row] ||= []).push({
              start:
                row === node.startPosition.row ? node.startPosition.column : 0,
              end:
                row === node.endPosition.row
                  ? node.endPosition.column
                  : Infinity,
              kind: name,
              priority: priority[name],
            });
          }
        }
        tree.delete();
        return source.split("\n").map((line, row) => {
          const ranges = tokens[row] || [];
          const boundaries = [
            ...new Set([
              0,
              line.length,
              ...ranges.flatMap((r) => [
                Math.min(r.start, line.length),
                Math.min(r.end, line.length),
              ]),
            ]),
          ].sort((a, b) => a - b);
          return boundaries.slice(0, -1).map((start, i) => {
            const end = boundaries[i + 1];
            const range = ranges
              .filter((r) => r.start <= start && r.end >= end)
              .sort((a, b) => b.priority - a.priority)[0];
            return {
              text: line.slice(start, end),
              start,
              end,
              kind: range?.kind || "plain",
            };
          });
        });
      };
    })();
  return initializing;
}
