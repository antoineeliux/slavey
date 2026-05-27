import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";
import { ChevronLeft, File, Folder, History, Pencil, Save, Trash2, X } from "lucide-react";

import { uiTheme } from "../lib/uiTheme";
import { useAppStore } from "../store/appStore";
import type { FsEntry } from "../types";

export function EditorPane() {
  const selectedEmployee = useAppStore((state) => state.selectedEmployee());
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const fileEntries = useAppStore((state) => state.fileEntries);
  const currentDir = useAppStore((state) => state.currentDir);
  const openFile = useAppStore((state) => state.openFile);
  const recentFiles = useAppStore((state) => state.recentFiles);
  const editorError = useAppStore((state) => state.editorError);
  const fileOperationError = useAppStore((state) => state.fileOperationError);
  const loadDir = useAppStore((state) => state.loadDir);
  const readFile = useAppStore((state) => state.readFile);
  const saveOpenFile = useAppStore((state) => state.saveOpenFile);
  const closeOpenFile = useAppStore((state) => state.closeOpenFile);
  const updateOpenFileContents = useAppStore((state) => state.updateOpenFileContents);
  const searchFiles = useAppStore((state) => state.searchFiles);
  const createFile = useAppStore((state) => state.createFile);
  const createDir = useAppStore((state) => state.createDir);
  const renamePath = useAppStore((state) => state.renamePath);
  const deletePath = useAppStore((state) => state.deletePath);
  const clearRecentFiles = useAppStore((state) => state.clearRecentFiles);
  const removeRecentFile = useAppStore((state) => state.removeRecentFile);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"search" | "grep" | "glob">("search");
  const [searchResults, setSearchResults] = useState<
    Array<{ path: string; lineNumber?: number | null; line?: string | null }>
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchHasRun, setSearchHasRun] = useState(false);

  useEffect(() => {
    if (selectedEmployee) {
      void loadDir(selectedEmployee.cwd);
    } else if (workspaceRoot && !currentDir) {
      void loadDir(workspaceRoot);
    }
  }, [currentDir, loadDir, selectedEmployee?.id, selectedEmployee?.cwd, workspaceRoot]);

  const parentPath = currentDir ? parentDir(currentDir) : null;
  const openError = openFile?.saveError ?? editorError;
  const searchRoot = selectedEmployee?.cwd ?? workspaceRoot;
  const searchDisabledReason = searchDisabledReasonFor(searchRoot, searchQuery);

  const runSearch = async () => {
    if (searchDisabledReason) {
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    setSearchHasRun(true);
    try {
      setSearchResults(await searchFiles(searchMode, searchQuery, searchRoot));
    } catch (error) {
      setSearchResults([]);
      setSearchError(String(error));
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <div className="editor-pane">
      <aside className="file-tree">
        <div className="pane-toolbar">
          <div className="toolbar-title">
            <Folder size={15} />
            Files
          </div>
          <button
            className="icon-button"
            disabled={!parentPath}
            title={parentPath ? "Parent directory" : "No parent directory"}
            onClick={() => parentPath && void loadDir(parentPath)}
          >
            <ChevronLeft size={15} />
          </button>
        </div>
        <div
          className="current-dir"
          title={currentDir ?? selectedEmployee?.cwd ?? workspaceRoot ?? ""}
        >
          {currentDir ?? selectedEmployee?.cwd ?? workspaceRoot ?? "No workspace"}
        </div>
        <div className="recent-files-panel">
          <div className="compact-panel-heading">
            <span>
              <History size={14} />
              Recent files
            </span>
            <button
              className="icon-button mini"
              disabled={recentFiles.length === 0}
              title="Clear recent files"
              onClick={() => void clearRecentFiles()}
            >
              <X size={13} />
            </button>
          </div>
          <div className="recent-file-list">
            {recentFiles.length === 0 ? (
              <div className="empty-line compact">No recent files</div>
            ) : (
              recentFiles.map((path) => (
                <div className="recent-file-row" key={path}>
                  <button
                    className="recent-file-main"
                    title={path}
                    onClick={() => void readFile(path)}
                  >
                    <File size={14} />
                    <span>{shortPath(path)}</span>
                  </button>
                  <button
                    className="icon-button mini"
                    title="Remove from recent files"
                    onClick={() => void removeRecentFile(path)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="file-list">
          {fileEntries.length === 0 ? (
            <div className="empty-panel compact-empty">
              No files listed for this directory.
            </div>
          ) : (
            fileEntries.map((entry) => (
              <FileTreeRow
                entry={entry}
                key={entry.path}
                onOpen={() => (entry.isDir ? void loadDir(entry.path) : void readFile(entry.path))}
                onRename={() => {
                  const nextPath = prompt("Rename path", entry.path);
                  if (nextPath?.trim() && nextPath.trim() !== entry.path) {
                    void renamePath(entry.path, nextPath.trim());
                  }
                }}
                onDelete={() => void deletePath(entry.path)}
              />
            ))
          )}
        </div>
        {fileOperationError ? (
          <div className="inline-warning file-error">{fileOperationError}</div>
        ) : null}
        <div className="file-actions">
          <button
            className="command-button compact"
            disabled={!currentDir}
            title={currentDir ? "Create file in current directory" : "Open a directory first"}
            onClick={() =>
              currentDir && void createFile(`${currentDir}/untitled-${Date.now()}.txt`, "")
            }
          >
            File
          </button>
          <button
            className="command-button compact"
            disabled={!currentDir}
            title={currentDir ? "Create directory in current directory" : "Open a directory first"}
            onClick={() =>
              currentDir && void createDir(`${currentDir}/folder-${Date.now()}`)
            }
          >
            Dir
          </button>
        </div>
        <div className="search-panel">
          <select
            value={searchMode}
            onChange={(event) =>
              setSearchMode(event.target.value as "search" | "grep" | "glob")
            }
          >
            <option value="search">Files</option>
            <option value="grep">Grep</option>
            <option value="glob">Glob</option>
          </select>
          <input
            value={searchQuery}
            placeholder="Search"
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void runSearch();
              }
            }}
          />
          <button
            className="command-button compact"
            disabled={Boolean(searchDisabledReason) || searchLoading}
            title={searchDisabledReason ?? `Run ${searchMode}`}
            onClick={() => void runSearch()}
          >
            {searchLoading ? "..." : "Go"}
          </button>
          <div className="search-results">
            {searchError ? <div className="inline-warning file-error">{searchError}</div> : null}
            {searchHasRun && !searchLoading && !searchError && searchResults.length === 0 ? (
              <div className="empty-line compact">No search results</div>
            ) : null}
            {searchResults.map((result) => (
              <button
                className="search-result"
                key={`${result.path}:${result.lineNumber ?? 0}:${result.line ?? ""}`}
                onClick={() => void readFile(result.path)}
              >
                <span title={result.path}>{shortPath(result.path)}</span>
                {result.line ? <code>{result.lineNumber}: {result.line}</code> : null}
              </button>
            ))}
          </div>
        </div>
      </aside>
      <section className="code-surface">
        <div className="pane-toolbar">
          <div className="toolbar-title">
            <File size={15} />
            {openFile ? shortPath(openFile.path) : "No file open"}
            {openFile?.dirty ? <span className="dirty-dot" title="Unsaved changes" /> : null}
          </div>
          <div className="toolbar-actions">
            <button
              className="command-button compact"
              disabled={!openFile || !openFile.dirty}
              title={
                !openFile
                  ? "Open a file before saving"
                  : openFile.dirty
                    ? "Save changes"
                    : "No unsaved changes"
              }
              onClick={() => void saveOpenFile()}
            >
              <Save size={14} />
              Save
            </button>
            <button
              className="icon-button"
              disabled={!openFile}
              title="Close file"
              onClick={() => closeOpenFile()}
            >
              <X size={14} />
            </button>
          </div>
        </div>
        {openFile ? (
          <div className="editor-meta">
            <span>{openFile.dirty ? "unsaved" : "saved"}</span>
            <span>{formatFileSize(openFile.metadata?.size)}</span>
            <span>{openFile.metadata?.readonly ? "readonly" : "writable"}</span>
            <span>{formatModified(openFile.metadata?.modified)}</span>
            <span>{openFile.metadata?.insideWorkspace ? "workspace" : "outside"}</span>
            {openFile.lastSavedAt ? (
              <span>saved {new Date(openFile.lastSavedAt).toLocaleTimeString()}</span>
            ) : null}
          </div>
        ) : null}
        {openError ? <div className="inline-warning editor-warning">{openError}</div> : null}
        {!openFile ? (
          <div className="editor-empty-state">
            Select a file from the tree or recent files to start editing.
          </div>
        ) : null}
        <CodeMirrorEditor
          value={openFile?.contents ?? ""}
          disabled={!openFile}
          onChange={updateOpenFileContents}
        />
      </section>
    </div>
  );
}

function FileTreeRow({
  entry,
  onOpen,
  onRename,
  onDelete,
}: {
  entry: FsEntry;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={entry.isDir ? "file-row-shell dir" : "file-row-shell"}>
      <button
        className={entry.isDir ? "file-row dir" : "file-row"}
        onClick={onOpen}
      >
        {entry.isDir ? <Folder size={15} /> : <File size={15} />}
        <span title={entry.path}>{entry.name}</span>
      </button>
      <button className="icon-button mini file-op-button" title="Rename" onClick={onRename}>
        <Pencil size={12} />
      </button>
      <button className="icon-button mini file-op-button" title="Delete" onClick={onDelete}>
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function CodeMirrorEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const editableRef = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          javascript({ jsx: true, typescript: true }),
          EditorView.lineWrapping,
          editableRef.current.of(EditorView.editable.of(!disabled)),
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: uiTheme.app,
              color: uiTheme.text,
              fontSize: "13px",
            },
            ".cm-scroller": {
              fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
            },
            ".cm-gutters": {
              backgroundColor: uiTheme.panelSubtle,
              color: uiTheme.textMuted,
              borderRight: `1px solid ${uiTheme.border}`,
            },
            ".cm-activeLine": {
              backgroundColor: uiTheme.surface,
            },
            ".cm-activeLineGutter": {
              backgroundColor: uiTheme.surfaceHover,
            },
            "&.cm-focused": {
              outline: "none",
            },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
              backgroundColor: uiTheme.selection,
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: editableRef.current.reconfigure(EditorView.editable.of(!disabled)),
    });
  }, [disabled]);

  return <div className={disabled ? "codemirror-host disabled" : "codemirror-host"} ref={hostRef} />;
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

function parentDir(path: string): string | null {
  const trimmed = path.replace(/[\\/]$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index <= 0) {
    return null;
  }
  return trimmed.slice(0, index);
}

function formatFileSize(size?: number | null): string {
  if (typeof size !== "number") {
    return "size unknown";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModified(modified?: number | null): string {
  return modified ? new Date(modified).toLocaleString() : "modified unknown";
}

function searchDisabledReasonFor(root: string | null, query: string): string | null {
  if (!root) {
    return "Open a workspace before searching";
  }
  if (query.trim().length === 0) {
    return "Enter a search query";
  }
  return null;
}
