import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  Maximize2,
  Minimize2,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  UserMinus,
  X,
} from "lucide-react";

import type { Employee, TerminalSessionRecord } from "../../types";
import { EmployeeTerminalSurface } from "../EmployeeTerminalSurface";
import { terminalStartDisabledReason } from "../terminalControls";

type TerminalDockMode = "docked" | "expanded";

type TerminalDockRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TerminalDockGeometry = Record<TerminalDockMode, TerminalDockRect>;

type TerminalDockBounds = {
  width: number;
  height: number;
};

type TerminalResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

type TerminalDockSizeConstraints = {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
};

const TERMINAL_RESIZE_HANDLES: Array<{
  direction: TerminalResizeDirection;
  label: string;
}> = [
  { direction: "n", label: "top edge" },
  { direction: "ne", label: "top right corner" },
  { direction: "e", label: "right edge" },
  { direction: "se", label: "bottom right corner" },
  { direction: "s", label: "bottom edge" },
  { direction: "sw", label: "bottom left corner" },
  { direction: "w", label: "left edge" },
  { direction: "nw", label: "top left corner" },
];

const TERMINAL_DOCK_GEOMETRY_STORAGE_KEY = "slavey.officeTerminalDock.geometry";
const LEGACY_TERMINAL_DOCK_SIZE_STORAGE_KEY = "slavey.officeTerminalDock.expandedSize";
const DEFAULT_DOCKED_SIZE = { width: 720, height: 360 };
const DEFAULT_EXPANDED_SIZE = { width: 1180, height: 680 };
const EDGE_PADDING = 12;

export function OfficeTerminalDock({
  employee,
  activeSession,
  expanded,
  onClose,
  onStartShell,
  onStop,
  onRelease,
  onToggleExpanded,
}: {
  employee: Employee | null;
  activeSession: TerminalSessionRecord | null;
  expanded: boolean;
  onClose: () => void;
  onStartShell: (employeeId: string) => void;
  onStop: (employeeId: string, sessionId: string) => void;
  onRelease: (employeeId: string) => void;
  onToggleExpanded: () => void;
}) {
  const mode: TerminalDockMode = expanded ? "expanded" : "docked";
  const dockRef = useRef<HTMLElement | null>(null);
  const [geometry, setGeometry] = useState<TerminalDockGeometry>(() =>
    readStoredTerminalDockGeometry(),
  );
  const [renderRepairSignal, setRenderRepairSignal] = useState(0);
  const latestGeometryRef = useRef(geometry);

  useEffect(() => {
    latestGeometryRef.current = geometry;
  }, [geometry]);

  const constrainGeometry = useCallback((persist = false) => {
    const bounds = terminalDockBounds(dockRef.current);
    setGeometry((current) => {
      const next = constrainTerminalDockGeometry(current, bounds);
      if (terminalDockGeometryEqual(current, next)) {
        return current;
      }
      latestGeometryRef.current = next;
      if (persist) {
        saveTerminalDockGeometry(next);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    constrainGeometry(true);
    const handleResize = () => constrainGeometry(true);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [constrainGeometry]);

  useEffect(() => {
    constrainGeometry(true);
  }, [constrainGeometry, mode]);

  const updateActiveRect = useCallback(
    (nextRect: TerminalDockRect, persist = false) => {
      const bounds = terminalDockBounds(dockRef.current);
      setGeometry((current) => {
        const next = {
          ...current,
          [mode]: constrainTerminalDockRect(nextRect, bounds, mode),
        };
        latestGeometryRef.current = next;
        if (persist) {
          saveTerminalDockGeometry(next);
        }
        return next;
      });
    },
    [mode],
  );

  const handleTitlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const startRect = latestGeometryRef.current[mode];

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        updateActiveRect({
          ...startRect,
          x: startRect.x + moveEvent.clientX - startX,
          y: startRect.y + moveEvent.clientY - startY,
        });
      };

      const handlePointerUp = () => {
        saveTerminalDockGeometry(latestGeometryRef.current);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [mode, updateActiveRect],
  );

  const handleResizePointerDown = useCallback(
    (direction: TerminalResizeDirection, event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const startRect = latestGeometryRef.current[mode];
      const bounds = terminalDockBounds(dockRef.current);

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        updateActiveRect(
          resizeTerminalDockRect(
            startRect,
            direction,
            moveEvent.clientX - startX,
            moveEvent.clientY - startY,
            bounds,
            mode,
          ),
        );
      };

      const handlePointerUp = () => {
        saveTerminalDockGeometry(latestGeometryRef.current);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [mode, updateActiveRect],
  );

  const handleResizeKeyDown = useCallback(
    (direction: TerminalResizeDirection, event: KeyboardEvent<HTMLButtonElement>) => {
      const delta = event.shiftKey ? 80 : event.altKey ? 5 : 20;
      const deltas = terminalResizeKeyboardDeltas(event.key, delta);
      if (!deltas) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const bounds = terminalDockBounds(dockRef.current);
      updateActiveRect(
        resizeTerminalDockRect(
          latestGeometryRef.current[mode],
          direction,
          deltas.deltaX,
          deltas.deltaY,
          bounds,
          mode,
        ),
        true,
      );
    },
    [mode, updateActiveRect],
  );

  const resetActiveRect = useCallback(() => {
    const bounds = terminalDockBounds(dockRef.current);
    const nextRect = defaultTerminalDockRect(mode, bounds);
    setGeometry((current) => {
      const next = {
        ...current,
        [mode]: nextRect,
      };
      latestGeometryRef.current = next;
      saveTerminalDockGeometry(next);
      return next;
    });
  }, [mode]);

  const terminalStyle = useMemo<CSSProperties>(() => {
    const rect = geometry[mode];
    return {
      "--office-terminal-x": `${rect.x}px`,
      "--office-terminal-y": `${rect.y}px`,
      "--office-terminal-width": `${rect.width}px`,
      "--office-terminal-height": `${rect.height}px`,
    } as CSSProperties;
  }, [geometry, mode]);

  if (!employee) {
    return null;
  }

  const sessionId = employee.terminalSessionId ?? null;
  const shellDisabledReason = terminalStartDisabledReason(employee, sessionId);

  return (
    <section
      className={expanded ? "office-terminal-dock expanded" : "office-terminal-dock"}
      aria-label={`${employee.name} terminal`}
      style={terminalStyle}
      ref={dockRef}
    >
      <div className="office-terminal-header">
        <div
          className="office-terminal-title"
          title="Drag terminal"
          onPointerDown={handleTitlePointerDown}
        >
          <strong>{employee.name}</strong>
          <span>
            {activeSession
              ? `${activeSession.label} · ${activeSession.status.replaceAll("_", " ")}`
              : sessionId
                ? "loading session"
                : "no active session"}
          </span>
        </div>
        <div className="office-terminal-actions">
          <button
            type="button"
            className="command-button compact"
            disabled={Boolean(shellDisabledReason)}
            title={shellDisabledReason ?? "Start shell"}
            onClick={() => onStartShell(employee.id)}
          >
            <Play size={13} />
            Shell
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={sessionId ? "Stop active session" : "No active session"}
            disabled={!sessionId}
            title={sessionId ? "Stop active session" : "No active session"}
            onClick={() => sessionId && onStop(employee.id, sessionId)}
          >
            <Square size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={
              employee.worktreePath
                ? "Release employee unavailable while worktree exists"
                : "Release employee"
            }
            disabled={Boolean(employee.worktreePath)}
            title={
              employee.worktreePath
                ? "Remove or archive the worktree before releasing"
                : "Release employee"
            }
            onClick={() => onRelease(employee.id)}
          >
            <UserMinus size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh terminal rendering"
            title="Refresh terminal rendering"
            onClick={() => setRenderRepairSignal((value) => value + 1)}
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Reset terminal position"
            title="Reset terminal position"
            onClick={resetActiveRect}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={expanded ? "Dock terminal" : "Expand terminal"}
            title={expanded ? "Dock terminal" : "Expand terminal"}
            onClick={onToggleExpanded}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Close terminal"
            title="Close terminal"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {activeSession ? (
        <div className="office-terminal-meta">
          <span>{activeSession.profile}</span>
          <span title={activeSession.cwd}>{shortPath(activeSession.cwd)}</span>
          <span>
            {activeSession.lastOutputAt ? `output ${formatTime(activeSession.lastOutputAt)}` : "active"}
          </span>
        </div>
      ) : null}
      <EmployeeTerminalSurface
        employee={employee}
        className="office-terminal-host"
        repairSignal={renderRepairSignal}
      />
      {TERMINAL_RESIZE_HANDLES.map(({ direction, label }) => (
        <div
          aria-hidden="true"
          className={`office-terminal-resize-zone ${direction}`}
          data-resize-direction={direction}
          key={direction}
          title={`Resize terminal from ${label}`}
          onPointerDown={(event) => handleResizePointerDown(direction, event)}
        />
      ))}
      <button
        type="button"
        className="office-terminal-resize-grip"
        aria-label="Resize terminal from bottom right corner"
        title="Resize terminal from bottom right corner"
        onPointerDown={(event) => handleResizePointerDown("se", event)}
        onKeyDown={(event) => handleResizeKeyDown("se", event)}
      />
    </section>
  );
}

function readStoredTerminalDockGeometry(): TerminalDockGeometry {
  const fallback = defaultTerminalDockGeometry();
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const rawValue = window.localStorage.getItem(TERMINAL_DOCK_GEOMETRY_STORAGE_KEY);
    if (rawValue) {
      const parsed = JSON.parse(rawValue) as Partial<Record<TerminalDockMode, Partial<TerminalDockRect>>>;
      return constrainTerminalDockGeometry(
        {
          docked: normalizeTerminalDockRect(parsed.docked, fallback.docked),
          expanded: normalizeTerminalDockRect(parsed.expanded, fallback.expanded),
        },
        windowTerminalDockBounds(),
      );
    }

    const legacySize = readLegacyTerminalDockSize();
    if (legacySize) {
      return constrainTerminalDockGeometry(
        {
          ...fallback,
          expanded: {
            ...fallback.expanded,
            width: legacySize.width,
            height: legacySize.height,
          },
        },
        windowTerminalDockBounds(),
      );
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function readLegacyTerminalDockSize(): Pick<TerminalDockRect, "width" | "height"> | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const rawValue = window.localStorage.getItem(LEGACY_TERMINAL_DOCK_SIZE_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    const parsed = JSON.parse(rawValue) as Partial<TerminalDockRect>;
    if (typeof parsed.width !== "number" || typeof parsed.height !== "number") {
      return null;
    }
    return { width: parsed.width, height: parsed.height };
  } catch {
    return null;
  }
}

function saveTerminalDockGeometry(geometry: TerminalDockGeometry): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(TERMINAL_DOCK_GEOMETRY_STORAGE_KEY, JSON.stringify(geometry));
  } catch {
    // The terminal geometry still updates for the current session when storage is unavailable.
  }
}

function normalizeTerminalDockRect(
  value: Partial<TerminalDockRect> | null | undefined,
  fallback: TerminalDockRect,
): TerminalDockRect {
  if (
    typeof value?.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number"
  ) {
    return fallback;
  }
  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  };
}

function defaultTerminalDockGeometry(bounds = windowTerminalDockBounds()): TerminalDockGeometry {
  return {
    docked: defaultTerminalDockRect("docked", bounds),
    expanded: defaultTerminalDockRect("expanded", bounds),
  };
}

function defaultTerminalDockRect(mode: TerminalDockMode, bounds: TerminalDockBounds): TerminalDockRect {
  const mobile = bounds.width <= 980;
  const size =
    mode === "expanded"
      ? {
          width: Math.min(DEFAULT_EXPANDED_SIZE.width, bounds.width - EDGE_PADDING * 2),
          height: Math.min(DEFAULT_EXPANDED_SIZE.height, bounds.height - 86),
        }
      : {
          width: Math.min(
            DEFAULT_DOCKED_SIZE.width,
            bounds.width - (mobile ? EDGE_PADDING * 2 : 456),
          ),
          height: Math.min(DEFAULT_DOCKED_SIZE.height, bounds.height - 126),
        };
  const constrained = constrainTerminalDockRect(
    {
      x: mode === "expanded" ? (mobile ? EDGE_PADDING : 24) : EDGE_PADDING,
      y:
        mode === "expanded"
          ? mobile
            ? 62
            : 70
          : bounds.height - Math.max(size.height, 0) - EDGE_PADDING,
      width: Math.max(size.width, 0),
      height: Math.max(size.height, 0),
    },
    bounds,
    mode,
  );
  return constrained;
}

function constrainTerminalDockGeometry(
  geometry: TerminalDockGeometry,
  bounds: TerminalDockBounds,
): TerminalDockGeometry {
  return {
    docked: constrainTerminalDockRect(geometry.docked, bounds, "docked"),
    expanded: constrainTerminalDockRect(geometry.expanded, bounds, "expanded"),
  };
}

function constrainTerminalDockRect(
  rect: TerminalDockRect,
  bounds: TerminalDockBounds,
  mode: TerminalDockMode,
): TerminalDockRect {
  const { minWidth, maxWidth, minHeight, maxHeight } = terminalDockSizeConstraints(
    mode,
    bounds,
  );
  const width = Math.round(Math.min(Math.max(rect.width, minWidth), maxWidth));
  const height = Math.round(Math.min(Math.max(rect.height, minHeight), maxHeight));
  const maxX = Math.max(EDGE_PADDING, bounds.width - width - EDGE_PADDING);
  const maxY = Math.max(EDGE_PADDING, bounds.height - height - EDGE_PADDING);
  return {
    x: Math.round(Math.min(Math.max(rect.x, EDGE_PADDING), maxX)),
    y: Math.round(Math.min(Math.max(rect.y, EDGE_PADDING), maxY)),
    width,
    height,
  };
}

function resizeTerminalDockRect(
  startRect: TerminalDockRect,
  direction: TerminalResizeDirection,
  deltaX: number,
  deltaY: number,
  bounds: TerminalDockBounds,
  mode: TerminalDockMode,
): TerminalDockRect {
  const { minWidth, maxWidth, minHeight, maxHeight } = terminalDockSizeConstraints(
    mode,
    bounds,
  );
  const leftEdgeMoves = direction.includes("w");
  const rightEdgeMoves = direction.includes("e");
  const topEdgeMoves = direction.includes("n");
  const bottomEdgeMoves = direction.includes("s");
  const startRight = startRect.x + startRect.width;
  const startBottom = startRect.y + startRect.height;
  let x = startRect.x;
  let y = startRect.y;
  let width = startRect.width;
  let height = startRect.height;

  if (leftEdgeMoves) {
    const minX = Math.max(EDGE_PADDING, startRight - maxWidth);
    const maxX = Math.max(minX, startRight - minWidth);
    x = clamp(startRect.x + deltaX, minX, maxX);
    width = startRight - x;
  } else if (rightEdgeMoves) {
    const minRight = startRect.x + minWidth;
    const maxRight = Math.min(bounds.width - EDGE_PADDING, startRect.x + maxWidth);
    width = clamp(startRight + deltaX, minRight, Math.max(minRight, maxRight)) - startRect.x;
  }

  if (topEdgeMoves) {
    const minY = Math.max(EDGE_PADDING, startBottom - maxHeight);
    const maxY = Math.max(minY, startBottom - minHeight);
    y = clamp(startRect.y + deltaY, minY, maxY);
    height = startBottom - y;
  } else if (bottomEdgeMoves) {
    const minBottom = startRect.y + minHeight;
    const maxBottom = Math.min(bounds.height - EDGE_PADDING, startRect.y + maxHeight);
    height =
      clamp(startBottom + deltaY, minBottom, Math.max(minBottom, maxBottom)) - startRect.y;
  }

  return constrainTerminalDockRect({ x, y, width, height }, bounds, mode);
}

function terminalResizeKeyboardDeltas(
  key: string,
  delta: number,
): { deltaX: number; deltaY: number } | null {
  switch (key) {
    case "ArrowLeft":
      return { deltaX: -delta, deltaY: 0 };
    case "ArrowRight":
      return { deltaX: delta, deltaY: 0 };
    case "ArrowUp":
      return { deltaX: 0, deltaY: -delta };
    case "ArrowDown":
      return { deltaX: 0, deltaY: delta };
    default:
      return null;
  }
}

function terminalDockSizeConstraints(
  mode: TerminalDockMode,
  bounds: TerminalDockBounds,
): TerminalDockSizeConstraints {
  const maxWidth = Math.max(280, bounds.width - EDGE_PADDING * 2);
  const maxHeight = Math.max(220, bounds.height - EDGE_PADDING * 2);
  return {
    minWidth: Math.min(mode === "expanded" ? 520 : 440, maxWidth),
    maxWidth,
    minHeight: Math.min(mode === "expanded" ? 320 : 260, maxHeight),
    maxHeight,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function terminalDockBounds(element: HTMLElement | null): TerminalDockBounds {
  const rect = element?.parentElement?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }
  return windowTerminalDockBounds();
}

function windowTerminalDockBounds(): TerminalDockBounds {
  if (typeof window === "undefined") {
    return { width: 1280, height: 800 };
  }
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

function terminalDockGeometryEqual(first: TerminalDockGeometry, second: TerminalDockGeometry): boolean {
  return (
    terminalDockRectEqual(first.docked, second.docked) &&
    terminalDockRectEqual(first.expanded, second.expanded)
  );
}

function terminalDockRectEqual(first: TerminalDockRect, second: TerminalDockRect): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}
