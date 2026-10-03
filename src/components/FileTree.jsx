import { useState, Fragment } from "react";
import { ChevronDown, ChevronRight, FolderOpen, FileCode2 } from "lucide-react";

export default function FileTree({ files, selected, onSelect, markedPaths }) {
  const [collapsed, setCollapsed] = useState({});
  const tree = {};
  for (const file of files) {
    let branch = tree;
    const parts = file.path.split("/");
    parts.forEach((part, i) => {
      if (i === parts.length - 1) branch[part] = file;
      else branch = branch[part] ||= {};
    });
  }
  function render(branch, depth = 0, parent = "") {
    return Object.entries(branch)
      .sort(
        (a, b) =>
          Boolean(a[1].source !== undefined) -
            Boolean(b[1].source !== undefined) || a[0].localeCompare(b[0]),
      )
      .map(([name, value]) => {
        const key = parent + "/" + name;
        if (value.source !== undefined)
          return (
            <button
              key={key}
              className={`tree-file ${selected === value.path ? "active" : ""}`}
              style={{ paddingLeft: 23 + depth * 13 }}
              onClick={() => onSelect(value)}
            >
              <FileCode2 size={13} />
              <span>{name}</span>
              {markedPaths?.has(value.path) && <span className="mark-dot tree-mark" role="img" aria-label="Contains marks" title="Contains marks" />}
              <small>{value.symbols.length}</small>
            </button>
          );
        return (
          <Fragment key={key}>
            <button
              className="tree-folder"
              style={{ paddingLeft: 12 + depth * 13 }}
              onClick={() => setCollapsed((v) => ({ ...v, [key]: !v[key] }))}
            >
              {collapsed[key] ? (
                <ChevronRight size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
              <FolderOpen size={13} />
              {name}
            </button>
            {!collapsed[key] && render(value, depth + 1, key)}
          </Fragment>
        );
      });
  }
  return render(tree);
}
