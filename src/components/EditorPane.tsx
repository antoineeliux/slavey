import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";
import { ChevronLeft, File, Folder, Save } from "lucide-react";

import { useAppStore } from "../store/appStore";

export function EditorPane() {
  const selectedEmployee = useAppStore((state) => state.selectedEmployee());
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const fileEntries = useAppStore((state) => state.fileEntries);
  const currentDir = useAppStore((state) => state.currentDir);
  const openFile = useAppStore((state) => state.openFile);
  const loadDir = useAppStore((state) => state.loadDir);
  const readFile = useAppStore((state) => state.readFile);
  const saveOpenFile = useAppStore((state) => state.saveOpenFile);
  const updateOpenFileContents = useAppStore((state) => state.updateOpenFileContents);

  useEffect(() => {
    if (selectedEmployee) {
      void loadDir(selectedEmployee.cwd);
    } else if (workspaceRoot && !currentDir) {
      void loadDir(workspaceRoot);
    }
  }, [currentDir, loadDir, selectedEmployee?.id, selectedEmployee?.cwd, workspaceRoot]);

  const parentPath = currentDir ? parentDir(currentDir) : null;

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
            title="Parent directory"
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
        <div className="file-list">
          {fileEntries.map((entry) => (
            <button
              className={entry.isDir ? "file-row dir" : "file-row"}
              key={entry.path}
              onClick={() => (entry.isDir ? void loadDir(entry.path) : void readFile(entry.path))}
            >
              {entry.isDir ? <Folder size={15} /> : <File size={15} />}
              <span title={entry.path}>{entry.name}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="code-surface">
        <div className="pane-toolbar">
          <div className="toolbar-title">
            <File size={15} />
            {openFile ? shortPath(openFile.path) : "No file open"}
            {openFile?.dirty ? <span className="dirty-dot" /> : null}
          </div>
          <button
            className="command-button compact"
            disabled={!openFile || !openFile.dirty}
            onClick={() => void saveOpenFile()}
          >
            <Save size={14} />
            Save
          </button>
        </div>
        <CodeMirrorEditor
          value={openFile?.contents ?? ""}
          disabled={!openFile}
          onChange={updateOpenFileContents}
        />
      </section>
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
              backgroundColor: "#111317",
              color: "#d9dee8",
              fontSize: "13px",
            },
            ".cm-scroller": {
              fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
            },
            ".cm-gutters": {
              backgroundColor: "#151820",
              color: "#707887",
              borderRight: "1px solid #252a34",
            },
            ".cm-activeLine": {
              backgroundColor: "#1a202b",
            },
            ".cm-activeLineGutter": {
              backgroundColor: "#202735",
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
