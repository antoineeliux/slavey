import * as commands from "../../lib/tauriCommands";
import { formatError, localLog } from "../helpers";
import type { AppStore, AppStoreSlice } from "../types";

type ActionsSlice = Pick<
  AppStore,
  | "approvals"
  | "actions"
  | "createApproval"
  | "approveApproval"
  | "rejectApproval"
  | "createAction"
  | "requestActionApproval"
  | "approveAction"
  | "rejectAction"
  | "runAction"
  | "cancelAction"
  | "upsertApproval"
  | "upsertAction"
>;

export const createActionsSlice: AppStoreSlice<ActionsSlice> = (set, get) => ({
  approvals: [],
  actions: [],

  createApproval: async (input) => {
    try {
      const approval = await commands.approvalCreate(input);
      get().upsertApproval(approval);
    } catch (error) {
      get().addLog(localLog("error", `create approval failed: ${formatError(error)}`));
    }
  },

  approveApproval: async (approvalId) => {
    try {
      const approval = await commands.approvalApprove(approvalId);
      get().upsertApproval(approval);
    } catch (error) {
      get().addLog(localLog("error", `approve request failed: ${formatError(error)}`));
    }
  },

  rejectApproval: async (approvalId) => {
    try {
      const approval = await commands.approvalReject(approvalId);
      get().upsertApproval(approval);
    } catch (error) {
      get().addLog(localLog("error", `reject request failed: ${formatError(error)}`));
    }
  },

  createAction: async (input) => {
    try {
      const action = await commands.actionCreate(input);
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `create action failed: ${formatError(error)}`));
    }
  },

  requestActionApproval: async (actionId) => {
    try {
      const action = await commands.actionRequestApproval(actionId);
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `request approval failed: ${formatError(error)}`));
    }
  },

  approveAction: async (actionId) => {
    try {
      const action = await commands.actionApprove(actionId);
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `approve action failed: ${formatError(error)}`));
    }
  },

  rejectAction: async (actionId) => {
    try {
      const action = await commands.actionReject(actionId);
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `reject action failed: ${formatError(error)}`));
    }
  },

  runAction: async (actionId) => {
    try {
      const action = await commands.actionRun(actionId);
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `run action failed: ${formatError(error)}`));
    }
  },

  cancelAction: async (actionId) => {
    try {
      const action = await commands.actionCancel(actionId);
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `cancel action failed: ${formatError(error)}`));
    }
  },

  upsertApproval: (approval) => {
    set((state) => {
      const exists = state.approvals.some((item) => item.id === approval.id);
      const approvals = exists
        ? state.approvals.map((item) => (item.id === approval.id ? approval : item))
        : [...state.approvals, approval];
      approvals.sort((a, b) => a.createdAt - b.createdAt);
      return { approvals };
    });
  },

  upsertAction: (action) => {
    set((state) => {
      const exists = state.actions.some((item) => item.id === action.id);
      const actions = exists
        ? state.actions.map((item) => (item.id === action.id ? action : item))
        : [...state.actions, action];
      actions.sort((a, b) => a.createdAt - b.createdAt);
      return { actions };
    });
  },
});
