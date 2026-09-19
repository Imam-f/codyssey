import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Box,
  Braces,
  FileCode2,
  Hash,
  Search,
  Type,
  Variable,
} from "lucide-react";
import { basename } from "../util";

function fileStats(file) {
  const top = file.symbols.filter((s) => s.scopeName === "<module>");
  const count = (kind) => top.filter((s) => s.kind === kind).length;
  return {
    lines: file.lines,
    classes: count("class"),
    functions: count("function"),
    variables: count("variable"),
    imports: count("import"),
    types: count("type"),
    total: top.length,
  };
}

const COLUMNS = [
  { key: "lines", label: "Lines" },
  { key: "classes", label: "Classes" },
  { key: "functions", label: "Functions" },
  { key: "variables", label: "Variables" },
  { key: "imports", label: "Imports" },
  { key: "types", label: "Types" },
  { key: "total", label: "Symbols" },
];

const EMPTY_TOTALS = {
  lines: 0,
  classes: 0,
  functions: 0,
  variables: 0,
  imports: 0,
  types: 0,
  total: 0,
};

function Metric({ icon, label, value }) {
  return (
    <div className="overview-metric">
      {icon}
      <b>{value.toLocaleString()}</b>
      <span>{label}</span>
    </div>
  );
}

export default function Overview({ repo, onNavigate }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("lines");
  const [sortDesc, setSortDesc] = useState(true);
  const rows = useMemo(() => {
    const all = repo.files.map((f) => ({ path: f.path, ...fileStats(f) }));
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? all.filter((r) => r.path.toLowerCase().includes(normalized))
      : all;
    return [...filtered].sort((a, b) =>
      sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey],
    );
  }, [repo, query, sortKey, sortDesc]);
  const totals = useMemo(() => {
    const t = { ...EMPTY_TOTALS };
    for (const f of repo.files) {
      const s = fileStats(f);
      for (const k of Object.keys(t)) t[k] += s[k];
    }
    return t;
  }, [repo]);

  function toggleSort(key) {
    if (sortKey === key) setSortDesc((v) => !v);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <div className="overview-view">
      <div className="overview-toolbar">
        <div>
          <h2>Overview</h2>
          <span>Lines of code and top-level symbols across the repository</span>
        </div>
        <label className="filter">
          <Search size={13} />
          <input
            aria-label="Filter files"
            placeholder="Filter files…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="overview-summary">
        <Metric
          icon={<FileCode2 size={15} />}
          label="Files"
          value={repo.files.length}
        />
        <Metric icon={<Hash size={15} />} label="Lines" value={totals.lines} />
        <Metric icon={<Box size={15} />} label="Classes" value={totals.classes} />
        <Metric
          icon={<Braces size={15} />}
          label="Functions"
          value={totals.functions}
        />
        <Metric
          icon={<Variable size={15} />}
          label="Variables"
          value={totals.variables}
        />
        <Metric
          icon={<ArrowUpRight size={15} />}
          label="Imports"
          value={totals.imports}
        />
        <Metric icon={<Type size={15} />} label="Types" value={totals.types} />
      </div>
      <div className="overview-body">
        <table className="overview-table">
          <thead>
            <tr>
              <th className="overview-file-col">File</th>
              {COLUMNS.map((col) => (
                <th key={col.key}>
                  <button
                    className={sortKey === col.key ? "sorted" : ""}
                    onClick={() => toggleSort(col.key)}
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span>{sortDesc ? "▾" : "▴"}</span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.path} onClick={() => onNavigate({ path: row.path })}>
                <td className="overview-file-col">
                  <span>
                    <FileCode2 size={13} />
                    <b>{basename(row.path)}</b>
                    <small>{row.path}</small>
                  </span>
                </td>
                {COLUMNS.map((col) => (
                  <td key={col.key} className="overview-num">
                    {row[col.key].toLocaleString()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty">No matching files.</p>}
      </div>
    </div>
  );
}
