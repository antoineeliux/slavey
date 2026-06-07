import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronUp, Folder, Home, Search } from "lucide-react";

import { fsListDir } from "../../lib/tauriCommands";
import type { FsEntry } from "../../types";

type OfficeDirectoryPickerProps = {
  value: string;
  workspaceRoot: string | null;
  placeholder: string;
  onChange: (path: string) => void;
};

export function OfficeDirectoryPicker({
  value,
  workspaceRoot,
  placeholder,
  onChange,
}: OfficeDirectoryPickerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const selectedPath = value.trim();
  const [open, setOpen] = useState(false);
  const [browseDir, setBrowseDir] = useState<string | null>(selectedPath || workspaceRoot);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let canceled = false;
    setLoading(true);
    setError(null);
    fsListDir(browseDir ?? workspaceRoot)
      .then((items) => {
        if (!canceled) {
          setEntries(items.filter((entry) => entry.isDir));
        }
      })
      .catch((err: unknown) => {
        if (!canceled) {
          setEntries([]);
          setError(String(err));
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [browseDir, open, workspaceRoot]);

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return entries;
    }
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.path.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  const currentPath = browseDir ?? workspaceRoot ?? "";
  const parentPath = currentPath ? parentDir(currentPath) : null;
  const canVisitParent = Boolean(
    parentPath &&
      workspaceRoot &&
      pathIsSameOrChild(parentPath, workspaceRoot),
  );
  const displayTitle = selectedPath || workspaceRoot || placeholder;
  const displayLabel = selectedPath ? shortPath(selectedPath) : "Workspace root";

  const openPicker = () => {
    setBrowseDir(selectedPath || workspaceRoot);
    setQuery("");
    setOpen((current) => !current);
  };

  const usePath = (path: string) => {
    onChange(path === workspaceRoot ? "" : path);
    setOpen(false);
  };

  return (
    <div className="office-directory-picker office-create-cwd" ref={hostRef}>
      <button
        type="button"
        className="office-directory-trigger"
        aria-label="Working directory"
        aria-expanded={open}
        title={displayTitle}
        onClick={openPicker}
      >
        <Folder size={14} />
        <span>{displayLabel}</span>
      </button>
      {open ? (
        <div className="office-directory-menu" role="dialog" aria-label="Choose working directory">
          <div className="office-directory-current">
            <span title={currentPath || displayTitle}>{currentPath || displayTitle}</span>
            <button
              type="button"
              className="icon-button mini"
              title="Use current directory"
              disabled={!currentPath}
              onClick={() => currentPath && usePath(currentPath)}
            >
              <Check size={13} />
            </button>
          </div>
          <label className="office-directory-search">
            <Search size={13} />
            <input
              type="search"
              value={query}
              aria-label="Search directories"
              placeholder="Search directories"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="office-directory-nav">
            <button
              type="button"
              className="icon-button mini"
              title="Workspace root"
              disabled={!workspaceRoot || currentPath === workspaceRoot}
              onClick={() => {
                setBrowseDir(workspaceRoot);
                setQuery("");
              }}
            >
              <Home size={13} />
            </button>
            <button
              type="button"
              className="icon-button mini"
              title="Parent directory"
              disabled={!canVisitParent}
              onClick={() => {
                setBrowseDir(parentPath);
                setQuery("");
              }}
            >
              <ChevronUp size={13} />
            </button>
          </div>
          <div className="office-directory-list">
            {loading ? <div className="empty-line compact">Loading directories</div> : null}
            {!loading && error ? <div className="inline-warning file-error">{error}</div> : null}
            {!loading && !error && visibleEntries.length === 0 ? (
              <div className="empty-line compact">No directories</div>
            ) : null}
            {!loading && !error
              ? visibleEntries.map((entry) => (
                  <div className="office-directory-row" key={entry.path}>
                    <button
                      type="button"
                      className="office-directory-main"
                      title={`Open ${entry.name}`}
                      onClick={() => {
                        setBrowseDir(entry.path);
                        setQuery("");
                      }}
                    >
                      <Folder size={14} />
                      <span>{entry.name}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-button mini"
                      title={`Use ${entry.name}`}
                      onClick={() => usePath(entry.path)}
                    >
                      <Check size={13} />
                    </button>
                  </div>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || path;
}

function parentDir(path: string): string | null {
  const trimmed = path.replace(/[\\/]$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index <= 0) {
    return null;
  }
  return trimmed.slice(0, index);
}

function pathIsSameOrChild(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
