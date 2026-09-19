import { useEffect, useState } from "react";
import { FileType2, Save, X, CircleAlert, Check } from "lucide-react";

export default function TypeEditor({ file, path, onSave, onClose, busy }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState(null);

  useEffect(() => {
    setText(file?.declaration?.source || "");
    setStatus(null);
  }, [file?.declaration?.source]);

  const pxdPath =
    file?.declaration?.path || path.replace(/\.(py|pyi)$/, ".pxd");

  async function save() {
    setStatus({ kind: "busy", text: "Analyzing…" });
    try {
      await onSave(path, text);
      setStatus({ kind: "ok", text: "Declarations applied" });
    } catch (error) {
      setStatus({ kind: "error", text: error.message });
    }
  }

  return (
    <aside className="type-editor">
      <header className="type-editor-header">
        <FileType2 size={13} />
        <span className="type-editor-title">{pxdPath}</span>
        <button
          title="Apply declarations and reindex"
          onClick={save}
          disabled={busy}
        >
          <Save size={13} />
          Apply
        </button>
        <button title="Close type editor" onClick={onClose}>
          <X size={13} />
        </button>
      </header>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        placeholder={
          "# Layer types on top of inference.\nprop positive_int: int\nmut prop data: { name: str }\ntype Row = { id: int }\n@pure\nprop lookup(d: { key: str }) -> str"
        }
      />
      <footer className="type-editor-footer">
        {status && (
          <span className={`type-status type-status-${status.kind}`}>
            {status.kind === "ok" ? (
              <Check size={12} />
            ) : status.kind === "error" ? (
              <CircleAlert size={12} />
            ) : null}
            {status.text}
          </span>
        )}
        <span className="type-hint">
          prop name: T · A | B · never · { "{ key: T }" } · mut · @pure / @side_effect
        </span>
      </footer>
    </aside>
  );
}
