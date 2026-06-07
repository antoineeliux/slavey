import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { MAX_TERMINAL_IMAGE_UPLOAD_BYTES } from "../lib/terminalImageUploadPolicy";
import { uiTheme } from "../lib/uiTheme";
import { useAppStore } from "../store/appStore";
import { formatError, localLog } from "../store/helpers";
import type { Employee } from "../types";

const TERMINAL_BOTTOM_TOLERANCE_LINES = 1;
const TERMINAL_SNAPSHOT_SCROLLBACK_LINES = 5000;
const TERMINAL_SNAPSHOT_TAIL_CHARS = 4096;
const TERMINAL_SNAPSHOT_MAX_CHARS = 4_000_000;
const TERMINAL_SNAPSHOT_MAX_SESSIONS = 24;
const TERMINAL_SNAPSHOT_MIN_INTERVAL_MS = 750;
const TERMINAL_IMAGE_DROP_DEDUPE_MS = 1_200;
const TERMINAL_IMAGE_DROP_CROSS_SOURCE_DEDUPE_MS = 750;

type TerminalScreenSnapshot = {
  data: string;
  bufferLength: number;
  bufferTail: string;
  cols: number;
  rows: number;
  viewportY: number;
  baseY: number;
  capturedAt: number;
};

type PendingSnapshotRestore = {
  sessionId: string;
  snapshot: TerminalScreenSnapshot;
};

type TerminalSurfaceCacheEntry = {
  terminal: Terminal;
  fit: FitAddon;
  serialize: SerializeAddon;
  renderedBuffer: string;
  lastUsedAt: number;
};

type TerminalImageDropDedupe = {
  exactKey: string;
  crossSourceKey: string;
  source: TerminalImageDropSource;
  handledAt: number;
};

type TerminalImageDropSource = "browser" | "tauri";

type TerminalImageFeedback = {
  message: string;
  tone: "busy" | "success" | "error";
};

const terminalScreenSnapshots = new Map<string, TerminalScreenSnapshot>();
const terminalSurfaceCache = new Map<string, TerminalSurfaceCacheEntry>();

export function EmployeeTerminalSurface({
  employee,
  className = "terminal-host",
  repairSignal = 0,
}: {
  employee: Employee | null;
  className?: string;
  repairSignal?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const serializeRef = useRef<SerializeAddon | null>(null);
  const cacheEntryRef = useRef<TerminalSurfaceCacheEntry | null>(null);
  const lastBufferRef = useRef("");
  const renderedBufferRef = useRef("");
  const lastSessionRef = useRef<string | null>(null);
  const employeeIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const fitResizeFrameRef = useRef<number | null>(null);
  const fitSettleFrameRef = useRef<number | null>(null);
  const renderRepairFrameRefs = useRef<number[]>([]);
  const renderRepairTimerRefs = useRef<number[]>([]);
  const lastHostSizeRef = useRef<{ width: number; height: number } | null>(null);
  const pendingSnapshotRestoreRef = useRef<PendingSnapshotRestore | null>(null);
  const lastResizeRef = useRef<{
    employeeId: string;
    sessionId: string;
    cols: number;
    rows: number;
  } | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const writeGenerationRef = useRef(0);
  const dragDepthRef = useRef(0);
  const nativeDragHasImagesRef = useRef(false);
  const imageDropDedupeRef = useRef<TerminalImageDropDedupe | null>(null);
  const imageFeedbackTimerRef = useRef<number | null>(null);
  const lastRepairSignalRef = useRef(repairSignal);
  const [imageDragActive, setImageDragActive] = useState(false);
  const [imageFeedback, setImageFeedback] = useState<TerminalImageFeedback | null>(null);
  const terminalBuffers = useAppStore((state) => state.terminalBuffers);
  const loadTerminalBuffer = useAppStore((state) => state.loadTerminalBuffer);
  const writeTerminal = useAppStore((state) => state.writeTerminal);
  const insertTerminalImage = useAppStore((state) => state.insertTerminalImage);
  const insertTerminalImagePath = useAppStore((state) => state.insertTerminalImagePath);
  const resizeTerminal = useAppStore((state) => state.resizeTerminal);
  const addLog = useAppStore((state) => state.addLog);
  const sessionId = employee?.terminalSessionId ?? null;
  const employeeId = employee?.id ?? null;
  const buffer = useMemo(
    () => (sessionId ? terminalBuffers[sessionId] ?? "" : ""),
    [sessionId, terminalBuffers],
  );
  const bufferLoaded = Boolean(
    sessionId && Object.prototype.hasOwnProperty.call(terminalBuffers, sessionId),
  );

  employeeIdRef.current = employeeId;
  sessionIdRef.current = sessionId;

  const scheduleFitAndResize = useCallback(() => {
    if (fitResizeFrameRef.current !== null) {
      return;
    }
    fitResizeFrameRef.current = requestTerminalAnimationFrame(() => {
      fitResizeFrameRef.current = null;
      const hostChanged = fitAndResizeVisibleTerminal(
        terminalRef.current,
        fitRef.current,
        hostRef.current,
        employeeIdRef,
        sessionIdRef,
        lastHostSizeRef,
        lastResizeRef,
        resizeTerminal,
      );

      if (!hostChanged || fitSettleFrameRef.current !== null) {
        return;
      }
      fitSettleFrameRef.current = requestTerminalAnimationFrame(() => {
        fitSettleFrameRef.current = null;
        fitAndResizeVisibleTerminal(
          terminalRef.current,
          fitRef.current,
          hostRef.current,
          employeeIdRef,
          sessionIdRef,
          lastHostSizeRef,
          lastResizeRef,
          resizeTerminal,
        );
      });
    });
  }, [resizeTerminal]);

  const scheduleRenderRepair = useCallback(() => {
    scheduleTerminalRenderRepair(
      terminalRef,
      fitRef,
      hostRef,
      employeeIdRef,
      sessionIdRef,
      lastHostSizeRef,
      lastResizeRef,
      renderRepairFrameRefs,
      renderRepairTimerRefs,
      resizeTerminal,
    );
  }, [resizeTerminal]);

  const showImageFeedback = useCallback(
    (message: string, tone: TerminalImageFeedback["tone"], timeoutMs = 2_400) => {
      if (imageFeedbackTimerRef.current !== null) {
        window.clearTimeout(imageFeedbackTimerRef.current);
        imageFeedbackTimerRef.current = null;
      }
      setImageFeedback({ message, tone });
      if (timeoutMs > 0) {
        imageFeedbackTimerRef.current = window.setTimeout(() => {
          imageFeedbackTimerRef.current = null;
          setImageFeedback(null);
        }, timeoutMs);
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (imageFeedbackTimerRef.current !== null) {
        window.clearTimeout(imageFeedbackTimerRef.current);
        imageFeedbackTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (lastRepairSignalRef.current === repairSignal) {
      return;
    }
    lastRepairSignalRef.current = repairSignal;
    scheduleFitAndResize();
    scheduleRenderRepair();
    terminalRef.current?.focus();
  }, [repairSignal, scheduleFitAndResize, scheduleRenderRepair]);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const cacheKey = sessionId;
    const cached = cacheKey ? terminalSurfaceCache.get(cacheKey) ?? null : null;
    const entry = cached ?? createTerminalSurfaceCacheEntry(hostRef.current);
    const { terminal, fit, serialize } = entry;
    cacheEntryRef.current = cacheKey ? entry : null;
    if (cacheKey && !cached) {
      terminalSurfaceCache.set(cacheKey, entry);
      pruneTerminalSurfaceCache(entry);
    }
    if (terminal.element && terminal.element.parentElement !== hostRef.current) {
      hostRef.current.appendChild(terminal.element);
    }
    terminalRef.current = terminal;
    fitRef.current = fit;
    serializeRef.current = serialize;
    lastSessionRef.current = cacheKey;
    lastBufferRef.current = cacheKey ? entry.renderedBuffer : "";
    renderedBufferRef.current = cacheKey ? entry.renderedBuffer : "";
    pendingSnapshotRestoreRef.current = null;
    scheduleFitAndResize();
    scheduleRenderRepair();

    const dataSubscription = terminal.onData((input) => {
      const nextEmployeeId = employeeIdRef.current;
      if (!nextEmployeeId) {
        return;
      }
      const currentEmployee = useAppStore
        .getState()
        .employees.find((item) => item.id === nextEmployeeId);
      const currentSession = currentEmployee?.terminalSessionId ?? sessionIdRef.current;
      if (currentEmployee && currentSession) {
        void writeTerminal(currentEmployee.id, currentSession, input);
      }
    });

    const observer = new ResizeObserver(scheduleFitAndResize);
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      dataSubscription.dispose();
      captureTerminalSnapshot(
        lastSessionRef.current,
        terminal,
        serialize,
        renderedBufferRef.current,
        true,
      );
      entry.renderedBuffer = renderedBufferRef.current;
      entry.lastUsedAt = Date.now();
      nextTerminalWriteGeneration(writeGenerationRef);
      if (fitResizeFrameRef.current !== null) {
        cancelTerminalAnimationFrame(fitResizeFrameRef.current);
        fitResizeFrameRef.current = null;
      }
      if (fitSettleFrameRef.current !== null) {
        cancelTerminalAnimationFrame(fitSettleFrameRef.current);
        fitSettleFrameRef.current = null;
      }
      cancelTerminalRenderRepair(renderRepairFrameRefs, renderRepairTimerRefs);
      if (cacheKey) {
        terminal.element?.remove();
      } else {
        terminal.dispose();
      }
      terminalRef.current = null;
      fitRef.current = null;
      serializeRef.current = null;
      cacheEntryRef.current = null;
    };
  }, [scheduleFitAndResize, scheduleRenderRepair, sessionId, writeTerminal]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    if (lastSessionRef.current !== sessionId) {
      captureTerminalSnapshot(
        lastSessionRef.current,
        terminal,
        serializeRef.current,
        renderedBufferRef.current,
        true,
      );
      const generation = nextTerminalWriteGeneration(writeGenerationRef);
      const snapshot = sessionId ? terminalScreenSnapshots.get(sessionId) ?? null : null;
      const snapshotCanRestore = snapshot
        ? !buffer || terminalSnapshotMatchesBuffer(snapshot, buffer)
        : false;
      enqueueTerminalTask(
        writeQueueRef,
        writeGenerationRef,
        terminalRef,
        terminal,
        generation,
        async (target) => {
          target.reset();
          if (!sessionId) {
            target.writeln("No terminal session attached.");
            renderedBufferRef.current = "";
            pendingSnapshotRestoreRef.current = null;
          } else if (snapshot && snapshotCanRestore) {
            await writeTerminalSnapshotRestore(target, snapshot, buffer);
            if (buffer) {
              renderedBufferRef.current = buffer;
              if (cacheEntryRef.current) {
                cacheEntryRef.current.renderedBuffer = buffer;
              }
              pendingSnapshotRestoreRef.current = null;
              captureTerminalSnapshot(sessionId, target, serializeRef.current, buffer);
            } else {
              pendingSnapshotRestoreRef.current = { sessionId, snapshot };
            }
          } else if (buffer) {
            await writeTerminalReplay(target, buffer);
            renderedBufferRef.current = buffer;
            if (cacheEntryRef.current) {
              cacheEntryRef.current.renderedBuffer = buffer;
            }
            pendingSnapshotRestoreRef.current = null;
            captureTerminalSnapshot(sessionId, target, serializeRef.current, buffer);
          }
          scheduleRenderRepair();
        },
      );
      lastSessionRef.current = sessionId;
      lastBufferRef.current = buffer;
      return;
    }

    const previous = lastBufferRef.current;
    const generation = writeGenerationRef.current;
    if (!bufferLoaded && previous) {
      scheduleRenderRepair();
      return;
    }
    const pendingSnapshotRestore = pendingSnapshotRestoreRef.current;
    if (
      pendingSnapshotRestore &&
      sessionId === pendingSnapshotRestore.sessionId &&
      buffer
    ) {
      pendingSnapshotRestoreRef.current = null;
      if (terminalSnapshotMatchesBuffer(pendingSnapshotRestore.snapshot, buffer)) {
        enqueueTerminalTask(
          writeQueueRef,
          writeGenerationRef,
          terminalRef,
          terminal,
          generation,
          async (target) => {
            await writeTerminalIncrement(
              target,
              buffer.slice(pendingSnapshotRestore.snapshot.bufferLength),
            );
            renderedBufferRef.current = buffer;
            if (cacheEntryRef.current) {
              cacheEntryRef.current.renderedBuffer = buffer;
            }
            captureTerminalSnapshot(sessionId, target, serializeRef.current, buffer);
            scheduleRenderRepair();
          },
        );
        lastBufferRef.current = buffer;
        return;
      }

      enqueueTerminalTask(
        writeQueueRef,
        writeGenerationRef,
        terminalRef,
        terminal,
        generation,
        async (target) => {
          await writeTerminalReplacement(target, buffer);
          renderedBufferRef.current = buffer;
          if (cacheEntryRef.current) {
            cacheEntryRef.current.renderedBuffer = buffer;
          }
          captureTerminalSnapshot(sessionId, target, serializeRef.current, buffer);
          scheduleRenderRepair();
        },
      );
      lastBufferRef.current = buffer;
      return;
    }

    if (buffer.startsWith(previous)) {
      const chunk = buffer.slice(previous.length);
      enqueueTerminalTask(
        writeQueueRef,
        writeGenerationRef,
        terminalRef,
        terminal,
        generation,
        async (target) => {
          await writeTerminalIncrement(target, chunk);
          renderedBufferRef.current = buffer;
          if (cacheEntryRef.current) {
            cacheEntryRef.current.renderedBuffer = buffer;
          }
          captureTerminalSnapshot(sessionId, target, serializeRef.current, buffer);
          scheduleRenderRepair();
        },
      );
    } else {
      enqueueTerminalTask(
        writeQueueRef,
        writeGenerationRef,
        terminalRef,
        terminal,
        generation,
        async (target) => {
          await writeTerminalReplacement(target, buffer);
          renderedBufferRef.current = buffer;
          if (cacheEntryRef.current) {
            cacheEntryRef.current.renderedBuffer = buffer;
          }
          captureTerminalSnapshot(sessionId, target, serializeRef.current, buffer);
          scheduleRenderRepair();
        },
      );
    }
    lastBufferRef.current = buffer;
  }, [buffer, bufferLoaded, scheduleRenderRepair, sessionId]);

  useEffect(() => {
    if (!employeeId || !sessionId) {
      return;
    }
    scheduleFitAndResize();
    scheduleRenderRepair();
  }, [employeeId, scheduleFitAndResize, scheduleRenderRepair, sessionId]);

  useEffect(() => {
    if (!employeeId || !sessionId) {
      return;
    }
    void loadTerminalBuffer(employeeId, sessionId);
  }, [employeeId, loadTerminalBuffer, sessionId]);

  const receiveTerminalImages = useCallback(
    async (files: File[]) => {
      const images = files.filter(isSupportedTerminalImageFile);
      if (images.length === 0) {
        showImageFeedback("Unsupported file", "error");
        addLog(localLog("warn", "terminal image upload ignored: no supported image files"));
        return;
      }

      const nextEmployeeId = employeeIdRef.current;
      if (!nextEmployeeId) {
        showImageFeedback("No active employee", "error");
        addLog(localLog("warn", "terminal image upload needs an active employee"));
        return;
      }
      const currentEmployee = useAppStore
        .getState()
        .employees.find((item) => item.id === nextEmployeeId);
      const currentSession = currentEmployee?.terminalSessionId ?? sessionIdRef.current;
      if (!currentEmployee || !currentSession) {
        showImageFeedback("No active terminal", "error");
        addLog(localLog("warn", "terminal image upload needs an active terminal session"));
        return;
      }

      showImageFeedback(terminalImageBusyLabel("Uploading", images.length), "busy", 0);
      let inserted = 0;
      let failed = 0;
      for (const image of images) {
        if (image.size > MAX_TERMINAL_IMAGE_UPLOAD_BYTES) {
          failed += 1;
          addLog(localLog("error", `terminal image upload failed: ${image.name || "image"} is too large`));
          continue;
        }
        try {
          const uploaded = await insertTerminalImage(
            currentEmployee.id,
            currentSession,
            await terminalImageUploadInput(image),
          );
          if (uploaded) {
            inserted += 1;
          } else {
            failed += 1;
          }
        } catch (error) {
          failed += 1;
          addLog(localLog("error", `terminal image read failed: ${formatError(error)}`));
        }
      }

      showImageFeedback(terminalImageResultLabel(inserted, failed), failed ? "error" : "success");
      terminalRef.current?.focus();
    },
    [addLog, insertTerminalImage, showImageFeedback],
  );

  const receiveTerminalImagePaths = useCallback(
    async (paths: string[]) => {
      const images = paths.filter(supportedImageName);
      if (images.length === 0) {
        showImageFeedback("Unsupported file", "error");
        addLog(localLog("warn", "terminal image drop ignored: no supported image files"));
        return;
      }

      const nextEmployeeId = employeeIdRef.current;
      if (!nextEmployeeId) {
        showImageFeedback("No active employee", "error");
        addLog(localLog("warn", "terminal image drop needs an active employee"));
        return;
      }
      const currentEmployee = useAppStore
        .getState()
        .employees.find((item) => item.id === nextEmployeeId);
      const currentSession = currentEmployee?.terminalSessionId ?? sessionIdRef.current;
      if (!currentEmployee || !currentSession) {
        showImageFeedback("No active terminal", "error");
        addLog(localLog("warn", "terminal image drop needs an active terminal session"));
        return;
      }

      showImageFeedback(terminalImageBusyLabel("Importing", images.length), "busy", 0);
      let inserted = 0;
      let failed = 0;
      for (const path of images) {
        const uploaded = await insertTerminalImagePath(currentEmployee.id, currentSession, { path });
        if (uploaded) {
          inserted += 1;
        } else {
          failed += 1;
        }
      }

      showImageFeedback(terminalImageResultLabel(inserted, failed), failed ? "error" : "success");
      terminalRef.current?.focus();
    },
    [addLog, insertTerminalImagePath, showImageFeedback],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const handleNativeDragEnter = (event: globalThis.DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current += 1;
      setImageDragActive(true);
    };
    const handleNativeDragOver = (event: globalThis.DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setImageDragActive(true);
    };
    const handleNativeDragLeave = (event: globalThis.DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setImageDragActive(false);
      }
    };
    const handleNativeDrop = (event: globalThis.DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setImageDragActive(false);
      if (event.dataTransfer) {
        const files = Array.from(event.dataTransfer.files);
        if (!terminalBrowserImageDropIsDuplicate(imageDropDedupeRef, files)) {
          void receiveTerminalImages(files);
        }
      }
    };

    host.addEventListener("dragenter", handleNativeDragEnter, true);
    host.addEventListener("dragover", handleNativeDragOver, true);
    host.addEventListener("dragleave", handleNativeDragLeave, true);
    host.addEventListener("drop", handleNativeDrop, true);
    return () => {
      host.removeEventListener("dragenter", handleNativeDragEnter, true);
      host.removeEventListener("dragover", handleNativeDragOver, true);
      host.removeEventListener("dragleave", handleNativeDragLeave, true);
      host.removeEventListener("drop", handleNativeDrop, true);
    };
  }, [receiveTerminalImages]);

  useEffect(() => {
    if (!tauriRuntimeAvailable()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    let disposed = false;

    void (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "leave") {
          nativeDragHasImagesRef.current = false;
          dragDepthRef.current = 0;
          setImageDragActive(false);
          return;
        }

        const insideTerminal = tauriDropPositionInsideElement(
          payload.position,
          hostRef.current,
          window.devicePixelRatio || 1,
        );
        if (payload.type === "enter") {
          nativeDragHasImagesRef.current =
            tauriDragPayloadSupportedImageState(payload) ?? false;
          setImageDragActive(insideTerminal && nativeDragHasImagesRef.current);
          return;
        }
        if (payload.type === "over") {
          const supportedImageState = tauriDragPayloadSupportedImageState(payload);
          if (supportedImageState !== null) {
            nativeDragHasImagesRef.current = supportedImageState;
          }
          setImageDragActive(insideTerminal && nativeDragHasImagesRef.current);
          return;
        }
        if (payload.type === "drop") {
          nativeDragHasImagesRef.current = false;
          dragDepthRef.current = 0;
          setImageDragActive(false);
          if (
            insideTerminal &&
            !terminalTauriImageDropIsDuplicate(imageDropDedupeRef, payload.paths)
          ) {
            void receiveTerminalImagePaths(payload.paths);
          }
        }
      });
      if (disposed) {
        unlisten();
        unlisten = null;
      }
    })().catch((error) => {
      addLog(localLog("warn", `terminal image drop listener failed: ${formatError(error)}`));
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addLog, receiveTerminalImagePaths]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const files = terminalImageFilesFromDataTransfer(event.clipboardData);
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void receiveTerminalImages(files);
    },
    [receiveTerminalImages],
  );

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setImageDragActive(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setImageDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setImageDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setImageDragActive(false);
      const files = Array.from(event.dataTransfer.files);
      if (!terminalBrowserImageDropIsDuplicate(imageDropDedupeRef, files)) {
        void receiveTerminalImages(files);
      }
    },
    [receiveTerminalImages],
  );

  const hostClassName = [
    className,
    "terminal-image-target",
    imageDragActive ? "terminal-image-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={hostClassName}
      data-terminal-image-status={imageFeedback?.message || undefined}
      data-terminal-image-status-tone={imageFeedback?.tone || undefined}
      ref={hostRef}
      onPaste={handlePaste}
      onPointerDown={() => terminalRef.current?.focus()}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    />
  );
}

type MutableRef<T> = {
  current: T;
};

function createTerminalSurfaceCacheEntry(host: HTMLElement): TerminalSurfaceCacheEntry {
  const terminal = new Terminal({
    cursorBlink: true,
    convertEol: false,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 5000,
    scrollOnEraseInDisplay: true,
    smoothScrollDuration: 0,
    theme: {
      background: uiTheme.app,
      foreground: uiTheme.text,
      cursor: uiTheme.accent,
      selectionBackground: uiTheme.selection,
      black: uiTheme.panelSubtle,
      red: uiTheme.danger,
      green: uiTheme.accent,
      yellow: uiTheme.warning,
      blue: uiTheme.textMuted,
      magenta: uiTheme.textMuted,
      cyan: uiTheme.textMuted,
      white: uiTheme.text,
    },
  });
  const fit = new FitAddon();
  const serialize = new SerializeAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(serialize);
  terminal.open(host);

  return {
    terminal,
    fit,
    serialize,
    renderedBuffer: "",
    lastUsedAt: Date.now(),
  };
}

function pruneTerminalSurfaceCache(activeEntry: TerminalSurfaceCacheEntry): void {
  while (terminalSurfaceCache.size > TERMINAL_SNAPSHOT_MAX_SESSIONS) {
    const evictable = Array.from(terminalSurfaceCache.entries())
      .filter(([, entry]) => entry !== activeEntry)
      .sort(([, first], [, second]) => first.lastUsedAt - second.lastUsedAt)[0];
    if (!evictable) {
      return;
    }
    const [sessionId, entry] = evictable;
    entry.terminal.dispose();
    terminalSurfaceCache.delete(sessionId);
  }
}

function requestTerminalAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelTerminalAnimationFrame(handle: number): void {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(handle);
    return;
  }
  window.clearTimeout(handle);
}

function cancelTerminalRenderRepair(
  frameRefs: MutableRef<number[]>,
  timerRefs: MutableRef<number[]>,
): void {
  for (const frame of frameRefs.current) {
    cancelTerminalAnimationFrame(frame);
  }
  for (const timer of timerRefs.current) {
    window.clearTimeout(timer);
  }
  frameRefs.current = [];
  timerRefs.current = [];
}

function nextTerminalWriteGeneration(ref: MutableRef<number>): number {
  ref.current += 1;
  return ref.current;
}

function enqueueTerminalTask(
  queueRef: MutableRef<Promise<void>>,
  generationRef: MutableRef<number>,
  terminalRef: MutableRef<Terminal | null>,
  terminal: Terminal,
  generation: number,
  task: (terminal: Terminal) => Promise<void> | void,
): void {
  queueRef.current = queueRef.current
    .then(async () => {
      if (generationRef.current !== generation || terminalRef.current !== terminal) {
        return;
      }
      await task(terminal);
    })
    .catch(() => undefined);
}

type ResizeTerminalFn = (
  employeeId: string,
  sessionId: string,
  cols: number,
  rows: number,
) => Promise<void>;

type TerminalViewportSnapshot = {
  viewportY: number;
  baseY: number;
  atBottom: boolean;
};

function scheduleTerminalRenderRepair(
  terminalRef: MutableRef<Terminal | null>,
  fitRef: MutableRef<FitAddon | null>,
  hostRef: MutableRef<HTMLElement | null>,
  employeeIdRef: MutableRef<string | null>,
  sessionIdRef: MutableRef<string | null>,
  lastHostSizeRef: MutableRef<{ width: number; height: number } | null>,
  lastResizeRef: MutableRef<{
    employeeId: string;
    sessionId: string;
    cols: number;
    rows: number;
  } | null>,
  frameRefs: MutableRef<number[]>,
  timerRefs: MutableRef<number[]>,
  resizeTerminal: ResizeTerminalFn,
): void {
  cancelTerminalRenderRepair(frameRefs, timerRefs);

  const repair = () => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    fitAndResizeVisibleTerminal(
      terminal,
      fitRef.current,
      hostRef.current,
      employeeIdRef,
      sessionIdRef,
      lastHostSizeRef,
      lastResizeRef,
      resizeTerminal,
    );
    refreshVisibleTerminal(terminal, true);
  };

  frameRefs.current = [
    requestTerminalAnimationFrame(repair),
    requestTerminalAnimationFrame(() => {
      const nestedFrame = requestTerminalAnimationFrame(repair);
      frameRefs.current.push(nestedFrame);
    }),
  ];
  timerRefs.current = [
    window.setTimeout(repair, 48),
    window.setTimeout(repair, 160),
  ];
}

function fitAndResizeVisibleTerminal(
  terminal: Terminal | null,
  fit: FitAddon | null,
  host: HTMLElement | null,
  employeeIdRef: MutableRef<string | null>,
  sessionIdRef: MutableRef<string | null>,
  lastHostSizeRef: MutableRef<{ width: number; height: number } | null>,
  lastResizeRef: MutableRef<{
    employeeId: string;
    sessionId: string;
    cols: number;
    rows: number;
  } | null>,
  resizeTerminal: ResizeTerminalFn,
): boolean {
  if (!terminal || !fit || !host || host.clientWidth <= 0 || host.clientHeight <= 0) {
    return false;
  }

  const previousHostSize = lastHostSizeRef.current;
  const nextHostSize = { width: host.clientWidth, height: host.clientHeight };
  const hostChanged =
    !previousHostSize ||
    previousHostSize.width !== nextHostSize.width ||
    previousHostSize.height !== nextHostSize.height;
  lastHostSizeRef.current = nextHostSize;

  const viewport = captureTerminalViewport(terminal);
  const previousCols = terminal.cols;
  const previousRows = terminal.rows;
  try {
    fit.fit();
  } catch {
    return hostChanged;
  }
  restoreTerminalViewport(terminal, viewport);
  refreshVisibleTerminal(terminal, true);

  const nextEmployeeId = employeeIdRef.current;
  if (!nextEmployeeId) {
    return hostChanged || previousCols !== terminal.cols || previousRows !== terminal.rows;
  }
  const currentEmployee = useAppStore
    .getState()
    .employees.find((item) => item.id === nextEmployeeId);
  const currentSession = currentEmployee?.terminalSessionId ?? sessionIdRef.current;
  if (!currentEmployee || !currentSession) {
    return hostChanged || previousCols !== terminal.cols || previousRows !== terminal.rows;
  }

  const nextSize = {
    employeeId: currentEmployee.id,
    sessionId: currentSession,
    cols: terminal.cols,
    rows: terminal.rows,
  };
  const previous = lastResizeRef.current;
  if (
    previous &&
    previous.employeeId === nextSize.employeeId &&
    previous.sessionId === nextSize.sessionId &&
    previous.cols === nextSize.cols &&
    previous.rows === nextSize.rows
  ) {
    return hostChanged || previousCols !== terminal.cols || previousRows !== terminal.rows;
  }
  lastResizeRef.current = nextSize;
  void resizeTerminal(nextSize.employeeId, nextSize.sessionId, nextSize.cols, nextSize.rows);
  return true;
}

function captureTerminalViewport(terminal: Terminal): TerminalViewportSnapshot {
  const buffer = terminal.buffer.active;
  return {
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    atBottom: terminalIsAtBottom(terminal),
  };
}

function restoreTerminalViewport(
  terminal: Terminal,
  viewport: TerminalViewportSnapshot,
): void {
  if (viewport.atBottom) {
    terminal.scrollToBottom();
    return;
  }

  const nextBaseY = terminal.buffer.active.baseY;
  if (viewport.baseY <= 0) {
    terminal.scrollToTop();
    return;
  }
  terminal.scrollToLine(Math.max(0, viewport.viewportY + nextBaseY - viewport.baseY));
}

function refreshVisibleTerminal(terminal: Terminal, clearTextureAtlas = false): void {
  if (terminal.rows > 0) {
    if (clearTextureAtlas) {
      terminal.clearTextureAtlas();
    }
    terminal.refresh(0, terminal.rows - 1);
  }
}

function captureTerminalSnapshot(
  sessionId: string | null,
  terminal: Terminal | null,
  serialize: SerializeAddon | null,
  renderedBuffer: string,
  force = false,
): void {
  if (!sessionId || !terminal || !serialize || renderedBuffer.length === 0) {
    return;
  }

  try {
    const capturedAt = Date.now();
    const previous = terminalScreenSnapshots.get(sessionId);
    if (
      !force &&
      previous &&
      capturedAt - previous.capturedAt < TERMINAL_SNAPSHOT_MIN_INTERVAL_MS
    ) {
      return;
    }

    const data = serialize.serialize({ scrollback: TERMINAL_SNAPSHOT_SCROLLBACK_LINES });
    if (!data || data.length > TERMINAL_SNAPSHOT_MAX_CHARS) {
      return;
    }

    const activeBuffer = terminal.buffer.active;
    terminalScreenSnapshots.delete(sessionId);
    terminalScreenSnapshots.set(sessionId, {
      data,
      bufferLength: renderedBuffer.length,
      bufferTail: renderedBuffer.slice(-TERMINAL_SNAPSHOT_TAIL_CHARS),
      cols: terminal.cols,
      rows: terminal.rows,
      viewportY: activeBuffer.viewportY,
      baseY: activeBuffer.baseY,
      capturedAt,
    });
    pruneTerminalSnapshots();
  } catch {
    // Snapshot restore is an optimization; raw backend replay remains the fallback.
  }
}

function terminalSnapshotMatchesBuffer(
  snapshot: TerminalScreenSnapshot,
  buffer: string,
): boolean {
  if (snapshot.bufferLength > buffer.length) {
    return false;
  }
  if (!snapshot.bufferTail) {
    return true;
  }

  const tailStart = snapshot.bufferLength - snapshot.bufferTail.length;
  if (tailStart < 0) {
    return false;
  }
  return buffer.slice(tailStart, snapshot.bufferLength) === snapshot.bufferTail;
}

function pruneTerminalSnapshots(): void {
  while (terminalScreenSnapshots.size > TERMINAL_SNAPSHOT_MAX_SESSIONS) {
    const oldestSessionId = terminalScreenSnapshots.keys().next().value;
    if (!oldestSessionId) {
      return;
    }
    terminalScreenSnapshots.delete(oldestSessionId);
  }
}

function writeTerminalIncrement(terminal: Terminal, chunk: string): Promise<void> {
  if (!chunk) {
    return Promise.resolve();
  }

  const previousViewportY = terminal.buffer.active.viewportY;
  const previousBaseY = terminal.buffer.active.baseY;
  const shouldFollowOutput = terminalIsAtBottom(terminal);

  return new Promise((resolve) => {
    terminal.write(chunk, () => {
      if (shouldFollowOutput) {
        terminal.scrollToBottom();
        refreshVisibleTerminal(terminal);
        resolve();
        return;
      }

      const nextBaseY = terminal.buffer.active.baseY;
      const baseDelta = nextBaseY - previousBaseY;
      terminal.scrollToLine(Math.max(0, previousViewportY + baseDelta));
      refreshVisibleTerminal(terminal);
      resolve();
    });
  });
}

function writeTerminalReplay(terminal: Terminal, buffer: string): Promise<void> {
  if (!buffer) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    terminal.write(buffer, () => {
      terminal.scrollToBottom();
      refreshVisibleTerminal(terminal);
      resolve();
    });
  });
}

function writeTerminalSnapshotRestore(
  terminal: Terminal,
  snapshot: TerminalScreenSnapshot,
  buffer: string,
): Promise<void> {
  if (snapshot.cols > 0 && snapshot.rows > 0) {
    terminal.resize(snapshot.cols, snapshot.rows);
  }

  const delta = buffer.slice(snapshot.bufferLength);
  const viewport = {
    viewportY: snapshot.viewportY,
    baseY: snapshot.baseY,
    atBottom: snapshot.baseY - snapshot.viewportY <= TERMINAL_BOTTOM_TOLERANCE_LINES,
  };

  return new Promise((resolve) => {
    terminal.write(`${snapshot.data}${delta}`, () => {
      restoreTerminalViewport(terminal, viewport);
      refreshVisibleTerminal(terminal);
      resolve();
    });
  });
}

function writeTerminalReplacement(terminal: Terminal, buffer: string): Promise<void> {
  const previousViewportY = terminal.buffer.active.viewportY;
  const previousBaseY = terminal.buffer.active.baseY;
  const shouldFollowOutput = terminalIsAtBottom(terminal);
  terminal.clear();

  if (!buffer) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    terminal.write(buffer, () => {
      if (shouldFollowOutput) {
        terminal.scrollToBottom();
        refreshVisibleTerminal(terminal);
        resolve();
        return;
      }

      const nextBaseY = terminal.buffer.active.baseY;
      if (previousBaseY <= 0) {
        terminal.scrollToTop();
        refreshVisibleTerminal(terminal);
        resolve();
        return;
      }
      terminal.scrollToLine(
        Math.max(0, Math.floor((previousViewportY / previousBaseY) * nextBaseY)),
      );
      refreshVisibleTerminal(terminal);
      resolve();
    });
  });
}

function terminalIsAtBottom(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  return buffer.baseY - buffer.viewportY <= TERMINAL_BOTTOM_TOLERANCE_LINES;
}

function dataTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  return Array.from(dataTransfer.types).includes("Files");
}

function terminalImageFilesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files).filter(isSupportedTerminalImageFile);
  if (files.length > 0) {
    return files;
  }

  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .filter(isSupportedTerminalImageFile);
}

function isSupportedTerminalImageFile(file: File): boolean {
  return file.type.startsWith("image/") || supportedImageName(file.name);
}

function supportedImageName(fileName: string): boolean {
  return /\.(png|jpe?g|webp|gif|heic|heif|tiff?|bmp)$/i.test(fileName);
}

function terminalImageBusyLabel(verb: string, count: number): string {
  return `${verb} ${count} image${count === 1 ? "" : "s"}`;
}

function terminalImageResultLabel(inserted: number, failed: number): string {
  if (inserted > 0 && failed > 0) {
    return `${inserted} inserted, ${failed} failed`;
  }
  if (inserted > 0) {
    return `${inserted} image${inserted === 1 ? "" : "s"} inserted`;
  }
  return "Image insert failed";
}

function terminalBrowserImageDropIsDuplicate(
  ref: MutableRef<TerminalImageDropDedupe | null>,
  files: File[],
): boolean {
  return terminalImageDropIsDuplicate(ref, "browser", terminalBrowserImageDropSignature(files));
}

function terminalTauriImageDropIsDuplicate(
  ref: MutableRef<TerminalImageDropDedupe | null>,
  paths: string[],
): boolean {
  return terminalImageDropIsDuplicate(ref, "tauri", terminalTauriImageDropSignature(paths));
}

function terminalImageDropIsDuplicate(
  ref: MutableRef<TerminalImageDropDedupe | null>,
  source: TerminalImageDropSource,
  signature: { exactKey: string; crossSourceKey: string },
): boolean {
  if (!signature.exactKey && !signature.crossSourceKey) {
    return false;
  }
  const now = Date.now();
  const previous = ref.current;
  ref.current = { ...signature, source, handledAt: now };
  return Boolean(
    previous &&
      ((previous.source === source &&
        signature.exactKey &&
        previous.exactKey === signature.exactKey &&
        now - previous.handledAt < TERMINAL_IMAGE_DROP_DEDUPE_MS) ||
        (previous.source !== source &&
          signature.crossSourceKey &&
          previous.crossSourceKey === signature.crossSourceKey &&
          now - previous.handledAt < TERMINAL_IMAGE_DROP_CROSS_SOURCE_DEDUPE_MS)),
  );
}

function terminalBrowserImageDropSignature(files: File[]): {
  exactKey: string;
  crossSourceKey: string;
} {
  return {
    exactKey: files
      .map((file) =>
        [
          terminalPathBaseName(file.name),
          file.size,
          file.lastModified,
          file.type.toLowerCase(),
        ].join(":"),
      )
      .sort((first, second) => first.localeCompare(second))
      .join("\0"),
    crossSourceKey: terminalImageDropCrossSourceKey(
      files.filter(isSupportedTerminalImageFile).map((file) => file.name),
    ),
  };
}

function terminalTauriImageDropSignature(paths: string[]): {
  exactKey: string;
  crossSourceKey: string;
} {
  return {
    exactKey: paths
      .map(terminalNormalizedPath)
      .sort((first, second) => first.localeCompare(second))
      .join("\0"),
    crossSourceKey: terminalImageDropCrossSourceKey(paths.filter(supportedImageName)),
  };
}

function terminalImageDropCrossSourceKey(namesOrPaths: string[]): string {
  return namesOrPaths
    .filter(supportedImageName)
    .map(terminalPathBaseName)
    .sort((first, second) => first.localeCompare(second))
    .join("\0");
}

function terminalNormalizedPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function terminalPathBaseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
}

function tauriDragPayloadSupportedImageState(payload: unknown): boolean | null {
  if (!payload || typeof payload !== "object" || !("paths" in payload)) {
    return null;
  }
  const paths = (payload as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) {
    return null;
  }
  return paths.some((path) => typeof path === "string" && supportedImageName(path));
}

type TauriDropPosition = {
  x: number;
  y: number;
  toLogical?: (scaleFactor: number) => {
    x: number;
    y: number;
  };
};

function tauriRuntimeAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function tauriDropPositionInsideElement(
  position: TauriDropPosition,
  element: HTMLElement | null,
  scaleFactor: number,
): boolean {
  if (!element) {
    return false;
  }

  const logicalPosition =
    typeof position.toLogical === "function"
      ? position.toLogical(scaleFactor)
      : {
          x: position.x / tauriScaleFactor(scaleFactor),
          y: position.y / tauriScaleFactor(scaleFactor),
        };
  const rect = element.getBoundingClientRect();
  return (
    logicalPosition.x >= rect.left &&
    logicalPosition.x <= rect.right &&
    logicalPosition.y >= rect.top &&
    logicalPosition.y <= rect.bottom
  );
}

function tauriScaleFactor(scaleFactor: number): number {
  return Number.isFinite(scaleFactor) && scaleFactor > 0
    ? scaleFactor
    : window.devicePixelRatio || 1;
}

async function terminalImageUploadInput(file: File) {
  return {
    fileName: file.name || `pasted-image.${extensionForMimeType(file.type) ?? "png"}`,
    mimeType: file.type || null,
    dataBase64: arrayBufferToBase64(await file.arrayBuffer()),
  };
}

function extensionForMimeType(mimeType: string): string | null {
  switch (mimeType.toLowerCase()) {
    case "image/png":
    case "image/x-png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
    case "image/pjpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/tiff":
    case "image/x-tiff":
      return "tiff";
    case "image/bmp":
    case "image/x-ms-bmp":
      return "bmp";
    default:
      return null;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
