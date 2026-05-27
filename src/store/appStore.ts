import { create } from "zustand";

import { createActionsSlice } from "./slices/actionsSlice";
import { createBootstrapSlice } from "./slices/bootstrapSlice";
import { createEditorSlice } from "./slices/editorSlice";
import { createEmployeesSlice } from "./slices/employeesSlice";
import { createEventsSlice } from "./slices/eventsSlice";
import { createProcessesSlice } from "./slices/processesSlice";
import { createReviewSlice } from "./slices/reviewSlice";
import { createTerminalSlice } from "./slices/terminalSlice";
import { createWorkspaceSlice } from "./slices/workspaceSlice";
import type { AppStore } from "./types";

export const useAppStore = create<AppStore>((set, get) => ({
  ...createEventsSlice(set, get),
  ...createWorkspaceSlice(set, get),
  ...createEmployeesSlice(set, get),
  ...createTerminalSlice(set, get),
  ...createActionsSlice(set, get),
  ...createReviewSlice(set, get),
  ...createProcessesSlice(set, get),
  ...createEditorSlice(set, get),
  ...createBootstrapSlice(set, get),
}));

export type { AppStore } from "./types";
