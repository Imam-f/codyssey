import { useEffect, useRef, useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { api } from "../util";
import "../stub-settings.css";

export default function StubSettings({ options, busy, error, onApply, onClose }) {
  const [paths, setPaths] = useState(options?.paths || []);
  const [useVenv, setUseVenv] = useState(options?.useVenv || false);
  const [chooseError, setChooseError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  async function addFolder() {
    setChoosing(true);
    setChooseError("");
    try {
      const directory = await api.chooseStubPath();
      if (directory) setPaths((previous) => [...new Set([...previous, directory])]);
    } catch (failure) { setChooseError(failure.message); }
    finally { setChoosing(false); }
  }
  const disabled = busy || choosing;
  return (
    <dialog className="stub-settings" ref={dialog} aria-labelledby="stub-settings-title"
      onCancel={(event) => { event.preventDefault(); if (!disabled) onClose(); }}>
      <div className="stub-settings-header">
        <h2 id="stub-settings-title">Dependency stubs</h2>
        <button onClick={onClose} disabled={disabled} aria-label="Close stub settings"><X size={16} /></button>
      </div>
      <p>Use external declarations to follow imports, types, and methods into dependency stub files.</p>
      <label className="stub-venv-option">
        <input type="checkbox" checked={useVenv} disabled={disabled} onChange={(event) => setUseVenv(event.target.checked)} />
        Use stubs from this repository’s .venv, venv, or env
      </label>
      <p className="stub-settings-help">Searches Windows and Unix site-packages for .pyi and .pxd files.</p>
      <h3>Additional folders</h3>
      {paths.length === 0 ? <p className="stub-settings-help">No additional stub folders selected.</p> : (
        <ul className="stub-paths">
          {paths.map((directory) => <li key={directory}>
            <span title={directory}>{directory}</span>
            <button disabled={disabled} onClick={() => setPaths((previous) => previous.filter((value) => value !== directory))}
              aria-label={`Remove stub folder ${directory}`}><X size={14} /></button>
          </li>)}
        </ul>
      )}
      <button className="stub-add-folder" onClick={addFolder} disabled={disabled || paths.length >= 20}>
        <FolderPlus size={14} />Add folder or virtual environment
      </button>
      <p className="stub-settings-help">Choose a virtual environment, site-packages, a typeshed checkout, or a folder containing package stubs. Project definitions take priority.</p>
      {(error || chooseError) && <p role="alert" className="stub-settings-error">{chooseError || error}</p>}
      <div className="stub-settings-footer">
        <span>Saved for this repository</span>
        <button disabled={disabled} onClick={onClose}>Cancel</button>
        <button className="stub-apply" disabled={disabled} onClick={() => onApply({ paths, useVenv })}>
          {busy ? "Indexing…" : "Apply and reindex"}
        </button>
      </div>
    </dialog>
  );
}
