import { listen } from "@tauri-apps/api/event";

import * as commands from "../../lib/tauriCommands";
import type {
  ActionUpdatedPayload,
  AppLog,
  ApprovalUpdatedPayload,
  EmployeeActivityUpdatedPayload,
  EmployeeUpdatedPayload,
  ProcessLogs,
  ProcessUpdatedPayload,
  TerminalDataPayload,
  TerminalSessionUpdatedPayload,
} from "../../types";
import {
  activitiesByEmployee,
  formatError,
  localLog,
  normalizeSettings,
} from "../helpers";
import type { AppStore, AppStoreSlice } from "../types";

type BootstrapSlice = Pick<AppStore, "backendReady" | "bootstrap" | "connectEvents">;

export const createBootstrapSlice: AppStoreSlice<BootstrapSlice> = (_set, get) => ({
  backendReady: false,

  bootstrap: async () => {
    const bootstrapStartActiveTab = get().activeTab;
    try {
      const snapshot = await commands.appStateLoad();
      const workspaceInfo = await commands.workspaceInfo();
      const approvals = await commands.approvalList();
      const actions = await commands.actionList();
      const processes = await commands.processList();
      const employeeActivities = await commands.employeeActivityList();
      const rolePolicies = await commands.employeeRolePolicies();
      const workspaceRoot = workspaceInfo.workspaceRoot || snapshot.workspaceRoot;
      const settings = normalizeSettings(workspaceInfo.settings ?? snapshot.settings);
      const selectedEmployeeId =
        snapshot.selectedEmployeeId &&
        snapshot.employees.some((employee) => employee.id === snapshot.selectedEmployeeId)
          ? snapshot.selectedEmployeeId
          : null;
      const activeTab =
        get().activeTab === bootstrapStartActiveTab
          ? "office"
          : get().activeTab;
      _set({
        employees: snapshot.employees,
        employeeActivities: activitiesByEmployee(employeeActivities),
        terminalSessions: snapshot.terminalSessions ?? [],
        selectedEmployeeId,
        workspaceRoot,
        workspaceInfo,
        recentWorkspaces: workspaceInfo.recentWorkspaces ?? snapshot.recentWorkspaces ?? [],
        settings,
        codexCliStatus: workspaceInfo.repoHealth.codexCliStatus,
        workspaceError: null,
        activeTab,
        recentFiles: snapshot.recentFiles ?? [],
        approvals,
        actions,
        processes,
        rolePolicies,
        backendReady: true,
      });
      void get().loadCodexCliStatus();
      const selected = snapshot.employees.find((employee) => employee.id === selectedEmployeeId);
      const targetDir = selected?.cwd ?? workspaceRoot;
      if (targetDir) {
        await get().loadDir(targetDir);
        await get().loadGitChangesForPath(targetDir);
      }
    } catch (error) {
      get().addLog(localLog("error", `backend unavailable: ${formatError(error)}`));
    }
  },

  connectEvents: async () => {
    if (commands.e2eTauriMockEnabled) {
      return [];
    }

    const terminalUnlisten = await listen<TerminalDataPayload>(
      "terminal:data",
      (event) => get().appendTerminalData(event.payload),
    );
    const terminalSessionUnlisten = await listen<TerminalSessionUpdatedPayload>(
      "terminal:session-updated",
      (event) => get().upsertTerminalSession(event.payload.session),
    );
    const employeeUnlisten = await listen<EmployeeUpdatedPayload>(
      "employee:updated",
      (event) => get().upsertEmployee(event.payload.employee),
    );
    const employeeActivityUnlisten = await listen<EmployeeActivityUpdatedPayload>(
      "employee:activity-updated",
      (event) => {
        const employeeId = event.payload.employeeId;
        if (employeeId) {
          void get().refreshEmployeeActivity(employeeId);
        } else {
          void get().loadEmployeeActivities();
        }
      },
    );
    const approvalUnlisten = await listen<ApprovalUpdatedPayload>(
      "approval:updated",
      (event) => get().upsertApproval(event.payload.approval),
    );
    const actionUnlisten = await listen<ActionUpdatedPayload>(
      "action:updated",
      (event) => get().upsertAction(event.payload.action),
    );
    const processUnlisten = await listen<ProcessUpdatedPayload>(
      "process:updated",
      (event) => get().upsertProcess(event.payload.process),
    );
    const processLogUnlisten = await listen<ProcessLogs>(
      "process:log",
      (event) => get().appendProcessLog(event.payload),
    );
    const logUnlisten = await listen<AppLog>("app:log", (event) =>
      get().addLog(event.payload),
    );
    return [
      terminalUnlisten,
      terminalSessionUnlisten,
      employeeUnlisten,
      employeeActivityUnlisten,
      approvalUnlisten,
      actionUnlisten,
      processUnlisten,
      processLogUnlisten,
      logUnlisten,
    ];
  },
});
