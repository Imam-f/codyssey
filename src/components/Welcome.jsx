import {
  ArrowRight,
  Box,
  Code2,
  FileCode2,
  FolderOpen,
  History,
  ListTree,
  LoaderCircle,
  X,
} from "lucide-react";
import { appVersion, isDesktop } from "../util";
import "./Welcome.css";

export default function Welcome({
  busy,
  recent,
  recentLoading,
  onOpen,
  onSample,
  onOpenRecent,
  onRemoveRecent,
}) {
  return (
    <main className="welcome-page" aria-busy={busy}>
      <div className="welcome-content">
        <header className="welcome-heading">
          <span className="welcome-mark">
            <Code2 size={30} />
          </span>
          <div className="welcome-eyebrow">YOUR NEXT CODE ODYSSEY</div>
          <h1>
            Understand the code.<br />
            <span>Find your way through.</span>
          </h1>
          <p>
            Explore Python repositories, follow definitions, and see how
            everything connects.
          </p>
        </header>

        <div className="welcome-columns">
          <section className="welcome-start" aria-labelledby="start-heading">
            <h2 id="start-heading">Start exploring</h2>
            <button className="welcome-open" onClick={onOpen} disabled={busy}>
              <FolderOpen size={20} />
              <span>
                <strong>Open repository</strong>
                <small>Choose a local Python project</small>
              </span>
              <kbd>Ctrl O</kbd>
            </button>
            <button className="welcome-sample" onClick={onSample} disabled={busy}>
              <Code2 size={18} />
              <span>
                <strong>Explore the sample</strong>
                <small>Take a look around with a bundled project</small>
              </span>
              <ArrowRight size={16} />
            </button>
            <p className="welcome-hint">
              {isDesktop
                ? "Analysis stays on your machine. Your code is never executed."
                : "Browser preview · Try the sample, or use the desktop app to open local folders."}
            </p>
            {busy && (
              <p className="welcome-progress" role="status">
                <LoaderCircle size={14} className="spin" /> Opening repository…
              </p>
            )}
          </section>

          <section className="welcome-recent" aria-labelledby="recent-heading">
            <h2 id="recent-heading">
              <History size={15} /> Recent repositories
            </h2>
            {recentLoading ? (
              <p className="welcome-empty">Loading recent repositories…</p>
            ) : recent.length ? (
              <ul className="recent-list">
                {recent.map((entry) => (
                  <li key={entry.root}>
                    <button
                      className="recent-open"
                      onClick={() => onOpenRecent(entry.root)}
                      disabled={busy}
                      title={entry.root}
                    >
                      <FolderOpen size={17} />
                      <span>
                        <strong>{entry.name}</strong>
                        <small>{entry.root}</small>
                      </span>
                      <ArrowRight size={14} />
                    </button>
                    <button
                      className="recent-remove"
                      onClick={() => onRemoveRecent(entry.root)}
                      disabled={busy}
                      aria-label={`Remove ${entry.name} from recent repositories`}
                      title="Remove from recent repositories"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="welcome-empty">
                <FolderOpen size={25} />
                <strong>A fresh start</strong>
                <p>
                  Repositories you open will appear here.<br />
                  Pick up right where your curiosity left off.
                </p>
              </div>
            )}
          </section>
        </div>

        <section className="welcome-features" aria-label="Explore with Codyssey">
          <div>
            <FileCode2 size={18} />
            <h3>Follow the source</h3>
            <p>Jump from a symbol to its definition and trace its usages.</p>
          </div>
          <div>
            <Box size={18} />
            <h3>Explore your classes</h3>
            <p>Map inheritance and inspect methods and properties.</p>
          </div>
          <div>
            <ListTree size={18} />
            <h3>Connect the calls</h3>
            <p>See what a function calls and what calls it.</p>
          </div>
        </section>
        <footer className="welcome-footer">
          <span>Codyssey <b>v{appVersion}</b></span>
          <span>Python, in perspective.</span>
        </footer>
      </div>
    </main>
  );
}
