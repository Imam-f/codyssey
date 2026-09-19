import { useState } from "react";
import {
  ArrowUpRight,
  Box,
  Braces,
  ChevronRight,
  Search,
  Variable,
} from "lucide-react";
import { basename } from "../util";

const emptyTracker = {
  addedMethods: [],
  overriddenMethods: [],
  inheritedMethods: [],
  addedProperties: [],
  overriddenProperties: [],
  inheritedProperties: [],
  dynamicProperties: [],
};

function MemberGroup({ title, tone, members, onNavigate }) {
  if (!members.length) return null;
  return (
    <section className="class-member-group">
      <div className="class-member-heading">
        <span className={`member-status ${tone}`}>{title}</span>
        <small>{members.length}</small>
      </div>
      <div className="class-member-list">
        {members.map((member) => (
          <button
            key={`${member.ownerId}:${member.kind}:${member.name}:${member.line}`}
            onClick={() =>
              onNavigate({
                id: member.symbolId,
                path: member.path,
                line: member.line,
              })
            }
          >
            <span className={`member-kind member-kind-${member.kind}`}>
              {member.kind === "method" ? (
                <Braces size={13} />
              ) : (
                <Variable size={13} />
              )}
            </span>
            <span className="member-name">{member.name}</span>
            <span className="member-origin">
              {member.relationship === "inherited"
                ? member.inheritedFrom
                : member.dynamic
                  ? `${member.definedIn}()`
                  : `${basename(member.path)}:${member.line}`}
            </span>
            <ArrowUpRight size={11} />
          </button>
        ))}
      </div>
    </section>
  );
}

export default function ClassTracker({ classes, onNavigate }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const normalized = query.trim().toLowerCase();
  const filtered = classes.filter((cls) => {
    const members = cls.memberTracker?.members || [];
    return (
      !normalized ||
      `${cls.name} ${cls.path} ${members.map((member) => member.name).join(" ")}`
        .toLowerCase()
        .includes(normalized)
    );
  });
  const selected =
    filtered.find((cls) => cls.id === selectedId) || filtered[0] || null;
  const tracker = selected?.memberTracker || emptyTracker;
  const stableAddedProperties = tracker.addedProperties.filter(
    (member) => !member.dynamic,
  );
  const localCount =
    tracker.addedMethods.length +
    tracker.overriddenMethods.length +
    tracker.addedProperties.length +
    tracker.overriddenProperties.length;
  const inheritedCount =
    tracker.inheritedMethods.length + tracker.inheritedProperties.length;

  return (
    <div className="class-tracker-view">
      <div className="class-tracker-toolbar">
        <div>
          <h2>Class tracker</h2>
          <span>Methods, properties, overrides, and dynamic fields</span>
        </div>
        <label className="filter">
          <Search size={13} />
          <input
            aria-label="Find tracked class or member"
            placeholder="Find class or member…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="class-tracker-body">
        <aside className="class-tracker-list">
          <div className="class-list-caption">
            <span>CLASSES</span>
            <small>{filtered.length}</small>
          </div>
          {filtered.map((cls) => {
            const memberTracker = cls.memberTracker || emptyTracker;
            return (
              <button
                key={cls.id}
                className={selected?.id === cls.id ? "active" : ""}
                onClick={() => setSelectedId(cls.id)}
              >
                <Box size={14} />
                <span>
                  <b>{cls.name}</b>
                  <small>{basename(cls.path)}</small>
                </span>
                {memberTracker.dynamicProperties.length > 0 && (
                  <span className="dynamic-count" title="Dynamic properties">
                    {memberTracker.dynamicProperties.length}
                  </span>
                )}
                <ChevronRight size={12} />
              </button>
            );
          })}
          {!filtered.length && <p className="empty">No matching classes.</p>}
        </aside>
        {selected ? (
          <div className="class-tracker-detail">
            <header className="class-detail-title">
              <span><Box size={20} /></span>
              <div>
                <button onClick={() => onNavigate(selected)}>
                  <h3>{selected.name}</h3>
                  <ArrowUpRight size={12} />
                </button>
                <p>{selected.path}:{selected.line}</p>
              </div>
              <div className="class-detail-bases">
                {selected.bases.length ? (
                  selected.bases.map((base) => <code key={base}>{base}</code>)
                ) : (
                  <code>object</code>
                )}
              </div>
            </header>
            <div className="class-metrics">
              <div><b>{localCount}</b><span>local</span></div>
              <div><b>{tracker.overriddenMethods.length + tracker.overriddenProperties.length}</b><span>overridden</span></div>
              <div><b>{inheritedCount}</b><span>inherited</span></div>
              <div className="dynamic"><b>{tracker.dynamicProperties.length}</b><span>dynamic</span></div>
            </div>
            <div className="class-member-columns">
              <div>
                <MemberGroup title="Added methods" tone="added" members={tracker.addedMethods} onNavigate={onNavigate} />
                <MemberGroup title="Added properties" tone="added" members={stableAddedProperties} onNavigate={onNavigate} />
                <MemberGroup title="Dynamic properties" tone="dynamic" members={tracker.dynamicProperties} onNavigate={onNavigate} />
              </div>
              <div>
                <MemberGroup title="Overridden methods" tone="overridden" members={tracker.overriddenMethods} onNavigate={onNavigate} />
                <MemberGroup title="Overridden properties" tone="overridden" members={tracker.overriddenProperties} onNavigate={onNavigate} />
                <MemberGroup title="Inherited methods" tone="inherited" members={tracker.inheritedMethods} onNavigate={onNavigate} />
                <MemberGroup title="Inherited properties" tone="inherited" members={tracker.inheritedProperties} onNavigate={onNavigate} />
              </div>
            </div>
            {!localCount && !inheritedCount && (
              <p className="empty">No statically tracked members.</p>
            )}
          </div>
        ) : (
          <div className="empty class-tracker-empty">No matching classes.</div>
        )}
      </div>
    </div>
  );
}
