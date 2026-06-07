import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState, RangeSetBuilder, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";
import {
  ChevronLeft,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  GitBranch,
  History,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { uiTheme } from "../lib/uiTheme";
import { useAppStore } from "../store/appStore";
import { gitPathFileKey, gitPathKey } from "../store/slices/reviewSlice";
import type { FsEntry, WorktreeReviewFile } from "../types";

export function EditorPane() {
  const employees = useAppStore((state) => state.employees);
  const selectedEmployeeId = useAppStore((state) => state.selectedEmployeeId);
  const selectedEmployee = useAppStore((state) => state.selectedEmployee());
  const terminalSessions = useAppStore((state) => state.terminalSessions);
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const fileEntries = useAppStore((state) => state.fileEntries);
  const currentDir = useAppStore((state) => state.currentDir);
  const openFile = useAppStore((state) => state.openFile);
  const recentFiles = useAppStore((state) => state.recentFiles);
  const editorError = useAppStore((state) => state.editorError);
  const fileOperationError = useAppStore((state) => state.fileOperationError);
  const gitPathChanges = useAppStore((state) => state.gitPathChanges);
  const gitPathFileDiffs = useAppStore((state) => state.gitPathFileDiffs);
  const selectedGitChangedFiles = useAppStore((state) => state.selectedGitChangedFiles);
  const selectEmployee = useAppStore((state) => state.selectEmployee);
  const setEmployeeWorkingFolder = useAppStore((state) => state.setEmployeeWorkingFolder);
  const loadDir = useAppStore((state) => state.loadDir);
  const readFile = useAppStore((state) => state.readFile);
  const saveOpenFile = useAppStore((state) => state.saveOpenFile);
  const closeOpenFile = useAppStore((state) => state.closeOpenFile);
  const updateOpenFileContents = useAppStore((state) => state.updateOpenFileContents);
  const searchFiles = useAppStore((state) => state.searchFiles);
  const loadGitChangesForPath = useAppStore((state) => state.loadGitChangesForPath);
  const selectGitChangedFile = useAppStore((state) => state.selectGitChangedFile);
  const createFile = useAppStore((state) => state.createFile);
  const createDir = useAppStore((state) => state.createDir);
  const renamePath = useAppStore((state) => state.renamePath);
  const deletePath = useAppStore((state) => state.deletePath);
  const clearRecentFiles = useAppStore((state) => state.clearRecentFiles);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"search" | "grep" | "glob">("search");
  const [searchResults, setSearchResults] = useState<
    Array<{ path: string; lineNumber?: number | null; line?: string | null }>
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchHasRun, setSearchHasRun] = useState(false);
  const [manualDiffFallbackPath, setManualDiffFallbackPath] = useState<string | null>(null);

  const editorRoot = selectedEmployee?.cwd ?? workspaceRoot;
  const activeSession = selectedEmployee?.terminalSessionId
    ? terminalSessions.find((session) => session.sessionId === selectedEmployee.terminalSessionId) ?? null
    : null;
  const terminalCurrentCwd = activeSession?.currentCwd ?? activeSession?.cwd ?? null;
  const terminalFolderDiffers =
    Boolean(selectedEmployee && terminalCurrentCwd) &&
    normalizePathForCompare(terminalCurrentCwd ?? "") !== normalizePathForCompare(selectedEmployee?.cwd ?? "");
  const changesKey = editorRoot ? gitPathKey(editorRoot) : null;
  const changes = changesKey ? gitPathChanges[changesKey] ?? null : null;
  const selectedChangedFile = changesKey ? selectedGitChangedFiles[changesKey] ?? null : null;
  const selectedChangedFileInfo =
    selectedChangedFile && changes
      ? changes.files.find((file) => file.path === selectedChangedFile) ?? null
      : null;
  const selectedDiff =
    editorRoot && selectedChangedFile
      ? gitPathFileDiffs[gitPathFileKey(editorRoot, selectedChangedFile)] ?? ""
      : "";
  const openFileChangedPath =
    openFile && changes?.repoRoot
      ? relativePathIfInside(openFile.path, changes.repoRoot)
      : null;
  const openFileDiff =
    openFileChangedPath && openFileChangedPath === selectedChangedFile ? selectedDiff : "";
  const showDiffFallback =
    Boolean(selectedChangedFile && selectedDiff) &&
    manualDiffFallbackPath === selectedChangedFile &&
    (selectedChangedFileInfo?.deleted ||
      !diffHasHunks(selectedDiff) ||
      openFileChangedPath !== selectedChangedFile);

  useEffect(() => {
    if (!editorRoot) {
      return;
    }
    setManualDiffFallbackPath(null);
    void loadDir(editorRoot);
    void loadGitChangesForPath(editorRoot);
  }, [editorRoot, loadDir, loadGitChangesForPath]);

  const parentPath = currentDir ? parentDir(currentDir) : null;
  const openError = openFile?.saveError ?? editorError;
  const saveConflict = Boolean(openFile?.saveError?.toLowerCase().includes("changed on disk"));
  const searchRoot = editorRoot;
  const searchDisabledReason = searchDisabledReasonFor(searchRoot, searchQuery);
  const groupedChangedFiles = changedFileGroups(changes?.files ?? []);
  const browsingDifferentDir =
    Boolean(currentDir && editorRoot) &&
    normalizePathForCompare(currentDir ?? "") !== normalizePathForCompare(editorRoot ?? "");

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
        <div className="editor-context-panel">
          <label className="editor-employee-select">
            <span>
              <UserRound size={13} />
              Employee
            </span>
            <select
              value={selectedEmployeeId ?? ""}
              onChange={(event) => {
                const nextEmployeeId = event.target.value || null;
                void selectEmployee(nextEmployeeId);
              }}
            >
              <option value="">Main workspace</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
          <div className="working-folder-block">
            <span>Working folder</span>
            <strong title={editorRoot ?? ""}>{editorRoot ?? "No workspace"}</strong>
          </div>
          {terminalFolderDiffers && selectedEmployee && terminalCurrentCwd ? (
            <div className="terminal-folder-prompt">
              <span title={terminalCurrentCwd}>Terminal is in {shortPath(terminalCurrentCwd)}</span>
              <button
                className="command-button compact"
                title={`Use ${terminalCurrentCwd} as ${selectedEmployee.name}'s working folder`}
                onClick={() => void setEmployeeWorkingFolder(selectedEmployee.id, terminalCurrentCwd)}
              >
                Use
              </button>
            </div>
          ) : null}
        </div>
        {browsingDifferentDir && currentDir ? (
          <div className="current-dir" title={currentDir}>
            Browsing {shortPath(currentDir)}
          </div>
        ) : null}
        {recentFiles.length > 0 ? (
          <details className="recent-files-panel">
            <summary className="compact-panel-heading">
              <span>
                <History size={14} />
                Recent files
              </span>
              <span className="summary-actions">
                <span className="panel-count">{recentFiles.length}</span>
                <button
                  className="icon-button mini"
                  title="Clear recent files"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void clearRecentFiles();
                  }}
                >
                  <X size={13} />
                </button>
              </span>
            </summary>
            <div className="recent-file-list">
              {recentFiles.map((path) => (
                <div className="recent-file-row" key={path}>
                  <button
                    className="recent-file-main"
                    title={path}
                    onClick={() => {
                      setManualDiffFallbackPath(null);
                      void readFile(path);
                    }}
                  >
                    <File size={14} />
                    <span>{shortPath(path)}</span>
                  </button>
                </div>
              ))}
            </div>
          </details>
        ) : null}
        <div className="changed-files-panel">
          <div className="compact-panel-heading">
            <span>
              <GitBranch size={14} />
              Changed files
            </span>
            <button
              className="icon-button mini"
              disabled={!editorRoot}
              title={editorRoot ? "Refresh changed files" : "Open a workspace first"}
              onClick={() => editorRoot && void loadGitChangesForPath(editorRoot)}
            >
              <RefreshCw size={13} />
            </button>
          </div>
          {!editorRoot ? (
            <div className="empty-line compact">No workspace</div>
          ) : changes && !changes.isRepo ? (
            <div className="empty-line compact">Not a Git repo</div>
          ) : changes && groupedChangedFiles.every((group) => group.files.length === 0) ? (
            <div className="empty-line compact">No changed files</div>
          ) : changes ? (
            <div className="changed-file-list">
              {sharedWorkingFolderLabel(selectedEmployeeId, selectedEmployee?.cwd ?? null, employees) ? (
                <div className="shared-change-label">
                  {sharedWorkingFolderLabel(selectedEmployeeId, selectedEmployee?.cwd ?? null, employees)}
                </div>
              ) : null}
              {groupedChangedFiles.map((group) =>
                group.files.length ? (
                  <div className="changed-file-group" key={group.title}>
                    <span className="changed-file-group-title">{group.title}</span>
                    {group.files.map((file) => (
                      <button
                        className={
                          file.path === selectedChangedFile ? "changed-file active" : "changed-file"
                        }
                        key={`${group.title}-${file.path}`}
                        title={file.path}
                        onClick={() => {
                          const repoRoot = changes.repoRoot ?? editorRoot;
                          setManualDiffFallbackPath(file.path);
                          selectGitChangedFile(editorRoot, file.path);
                          if (!file.deleted) {
                            void readFile(joinPath(repoRoot, file.path));
                          }
                        }}
                      >
                        <span>{file.path}</span>
                        <span className="changed-file-status">{changeLabel(file)}</span>
                      </button>
                    ))}
                  </div>
                ) : null,
              )}
            </div>
          ) : (
            <div className="empty-line compact">Changes not loaded</div>
          )}
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
                onOpen={() => {
                  setManualDiffFallbackPath(null);
                  return entry.isDir ? void loadDir(entry.path) : void readFile(entry.path);
                }}
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
            className="icon-button"
            aria-label="New file"
            disabled={!currentDir}
            title={currentDir ? "Create file in current directory" : "Open a directory first"}
            onClick={() =>
              currentDir && void createFile(`${currentDir}/untitled-${Date.now()}.txt`, "")
            }
          >
            <FilePlus size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="New directory"
            disabled={!currentDir}
            title={currentDir ? "Create directory in current directory" : "Open a directory first"}
            onClick={() =>
              currentDir && void createDir(`${currentDir}/folder-${Date.now()}`)
            }
          >
            <FolderPlus size={14} />
          </button>
        </div>
        <details className="search-panel">
          <summary className="compact-panel-heading">
            <span>
              <Search size={14} />
              Search
            </span>
          </summary>
          <div className="search-controls">
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
          </div>
          <div className="search-results">
            {searchError ? <div className="inline-warning file-error">{searchError}</div> : null}
            {searchHasRun && !searchLoading && !searchError && searchResults.length === 0 ? (
              <div className="empty-line compact">No search results</div>
            ) : null}
            {searchResults.map((result) => (
              <button
                className="search-result"
                key={`${result.path}:${result.lineNumber ?? 0}:${result.line ?? ""}`}
                onClick={() => {
                  setManualDiffFallbackPath(null);
                  void readFile(result.path);
                }}
              >
                <span title={result.path}>{shortPath(result.path)}</span>
                {result.line ? <code>{result.lineNumber}: {result.line}</code> : null}
              </button>
            ))}
          </div>
        </details>
      </aside>
      <section className="code-surface">
        <div className="pane-toolbar">
          <div className="toolbar-title">
            <File size={15} />
            {openFile ? shortPath(openFile.path) : "No file open"}
            {openFile?.dirty ? <span className="dirty-dot" title="Unsaved changes" /> : null}
            {openFile?.metadata?.readonly ? (
              <span className="toolbar-muted">readonly</span>
            ) : null}
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
              onClick={async () => {
                await saveOpenFile();
                if (editorRoot) {
                  await loadGitChangesForPath(editorRoot);
                }
              }}
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
        {openError ? <div className="inline-warning editor-warning">{openError}</div> : null}
        {saveConflict ? (
          <div className="editor-save-guidance">
            Save conflict detected. Review the file on disk before overwriting this editor buffer.
          </div>
        ) : null}
        {showDiffFallback && selectedChangedFile ? (
          <DiffFallback
            defaultOpen={!openFile || openFileChangedPath !== selectedChangedFile}
            diff={selectedDiff}
            path={selectedChangedFile}
          />
        ) : null}
        {!openFile ? (
          <div className="editor-empty-state">
            Select a file from the tree or changed files to start editing.
          </div>
        ) : null}
        <CodeMirrorEditor
          value={openFile?.contents ?? ""}
          disabled={!openFile}
          diffText={openFileDiff}
          onChange={updateOpenFileContents}
        />
      </section>
    </div>
  );
}

function DiffFallback({
  defaultOpen,
  diff,
  path,
}: {
  defaultOpen: boolean;
  diff: string;
  path: string;
}) {
  return (
    <details className="editor-diff-fallback" open={defaultOpen}>
      <summary title={path}>Diff: {path}</summary>
      <pre aria-label={`${path} diff`}>{diff}</pre>
    </details>
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
  diffText,
  onChange,
}: {
  value: string;
  disabled: boolean;
  diffText: string;
  onChange: (value: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const editableRef = useRef(new Compartment());
  const diffRef = useRef(new Compartment());

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
          diffRef.current.of(diffDecorationsExtension(diffText)),
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

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: diffRef.current.reconfigure(diffDecorationsExtension(diffText)),
    });
  }, [diffText, value]);

  return <div className={disabled ? "codemirror-host disabled" : "codemirror-host"} ref={hostRef} />;
}

function changedFileGroups(files: WorktreeReviewFile[]) {
  const isConflicted = (file: WorktreeReviewFile) => file.conflicted;
  const isUntracked = (file: WorktreeReviewFile) => !isConflicted(file) && file.untracked;
  const isMixed = (file: WorktreeReviewFile) =>
    !isConflicted(file) && !isUntracked(file) && file.staged && file.unstaged;
  const isStagedOnly = (file: WorktreeReviewFile) =>
    !isConflicted(file) && !isUntracked(file) && !isMixed(file) && file.staged;
  const isUnstagedOnly = (file: WorktreeReviewFile) =>
    !isConflicted(file) && !isUntracked(file) && !isMixed(file) && file.unstaged;

  return [
    { title: "Conflicted", files: files.filter(isConflicted) },
    { title: "Mixed", files: files.filter(isMixed) },
    { title: "Staged", files: files.filter(isStagedOnly) },
    { title: "Unstaged", files: files.filter(isUnstagedOnly) },
    { title: "Untracked", files: files.filter(isUntracked) },
  ];
}

function changeLabel(file: WorktreeReviewFile): string {
  if (file.conflicted) return "conflict";
  if (file.untracked) return "new";
  if (file.deleted) return "deleted";
  if (file.renamed) return "renamed";
  if (file.staged && file.unstaged) return "mixed";
  if (file.staged) return "staged";
  if (file.unstaged) return "modified";
  return file.status.trim() || "changed";
}

function sharedWorkingFolderLabel(
  selectedEmployeeId: string | null,
  workingFolder: string | null,
  employees: Array<{ id: string; cwd: string; name: string }>,
): string | null {
  if (!selectedEmployeeId || !workingFolder) {
    return null;
  }
  const normalized = normalizePathForCompare(workingFolder);
  const shared = employees.filter(
    (employee) =>
      employee.id !== selectedEmployeeId && normalizePathForCompare(employee.cwd) === normalized,
  );
  if (shared.length === 0) {
    return null;
  }
  return `Shared with ${shared.map((employee) => employee.name).join(", ")}`;
}

function joinPath(root: string, path: string): string {
  return `${root.replace(/[\\/]$/, "")}/${path.replace(/^[\\/]/, "")}`;
}

function relativePathIfInside(path: string, root: string): string | null {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedRoot = normalizePathForCompare(root);
  if (normalizedPath === normalizedRoot) {
    return "";
  }
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : null;
}

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function diffDecorationsExtension(diffText: string) {
  return EditorView.decorations.compute(["doc"], (state) =>
    buildDiffDecorations(state.doc, diffText),
  );
}

function diffHasHunks(diffText: string): boolean {
  return /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(diffText);
}

function buildDiffDecorations(doc: Text, diffText: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const lines = diffText.split(/\r?\n/);
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addLineDecoration(builder, doc, newLine, "cm-diff-added");
      newLine += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      addDeletedLineWidget(builder, doc, newLine, line.slice(1));
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    }
  }

  return builder.finish();
}

function addLineDecoration(
  builder: RangeSetBuilder<Decoration>,
  doc: Text,
  lineNumber: number,
  className: string,
): void {
  if (lineNumber < 1 || lineNumber > doc.lines) {
    return;
  }
  const line = doc.line(lineNumber);
  builder.add(line.from, line.from, Decoration.line({ class: className }));
}

function addDeletedLineWidget(
  builder: RangeSetBuilder<Decoration>,
  doc: Text,
  lineNumber: number,
  text: string,
): void {
  const targetLine = Math.min(Math.max(lineNumber, 1), doc.lines);
  const position = doc.lines === 0 ? 0 : doc.line(targetLine).from;
  builder.add(
    position,
    position,
    Decoration.widget({
      block: true,
      side: -1,
      widget: new DeletedLineWidget(text),
    }),
  );
}

class DeletedLineWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-diff-deleted";
    element.textContent = `- ${this.text}`;
    return element;
  }
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

function searchDisabledReasonFor(root: string | null, query: string): string | null {
  if (!root) {
    return "Open a workspace before searching";
  }
  if (query.trim().length === 0) {
    return "Enter a search query";
  }
  return null;
}
