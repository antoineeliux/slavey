import { invoke } from "@tauri-apps/api/core";

import type {
  Action,
  ActionKind,
  AppSettings,
  AppSettingsUpdate,
  AppStateSnapshot,
  ApprovalRequest,
  CodexCliStatus,
  DiagnosticsExportBundle,
  DiagnosticsSummary,
  Employee,
  EmployeeActivity,
  EmployeeRole,
  FileMetadata,
  FilePayload,
  FsEntry,
  FsSearchResult,
  ManagedProcess,
  ProcessLogs,
  RolePolicy,
  TerminalSessionRecord,
  WorktreeCommit,
  WorktreeHandoffApplyResult,
  WorktreeHandoffPreflight,
  WorktreeReview,
  WorktreeStatus,
  WorkspaceInfo,
} from "../types";

export type CreateEmployeeInput = {
  name: string;
  role: EmployeeRole;
  cwd?: string;
};

export type CreateApprovalInput = {
  employeeId: string;
  actionId?: string | null;
  kind: ApprovalRequest["kind"];
  title: string;
  description: string;
  command?: string | null;
  path?: string | null;
  cwd?: string | null;
};

export type CreateActionInput = {
  employeeId: string;
  kind: ActionKind;
  title: string;
  description: string;
  cwd?: string | null;
  command?: string | null;
  path?: string | null;
  contents?: string | null;
  timeoutSecs?: number | null;
};

export type WorktreeHandoffAbortResult = {
  employeeId: string;
  aborted: boolean;
  operation?: string | null;
  stdout: string;
  stderr: string;
  message: string;
};

export function appStateLoad(): Promise<AppStateSnapshot> {
  return invoke("app_state_load");
}

export function appStateSave(payload: {
  selectedEmployeeId: string | null;
  activeTab: string;
  recentFiles: string[];
}): Promise<void> {
  return invoke("app_state_save", { payload });
}

export function workspaceInfo(): Promise<WorkspaceInfo> {
  return invoke("workspace_info");
}

export function workspaceSetRoot(path: string): Promise<WorkspaceInfo> {
  return invoke("workspace_set_root", { path });
}

export function workspaceRecentClear(): Promise<string[]> {
  return invoke("workspace_recent_clear");
}

export function settingsUpdate(payload: AppSettingsUpdate): Promise<AppSettings> {
  return invoke("settings_update", { payload });
}

export function employeeCreate(payload: CreateEmployeeInput): Promise<Employee> {
  return invoke("employee_create", { payload });
}

export function employeeRemove(employeeId: string): Promise<void> {
  return invoke("employee_remove", { employeeId });
}

export function employeeRolePolicies(): Promise<RolePolicy[]> {
  return invoke("employee_role_policies");
}

export function employeeStartTerminal(employeeId: string): Promise<Employee> {
  return invoke("employee_start_terminal", { employeeId });
}

export function employeeStartCodexTerminal(employeeId: string): Promise<Employee> {
  return invoke("employee_start_codex_terminal", { employeeId });
}

export function employeeStopTerminal(employeeId: string): Promise<Employee> {
  return invoke("employee_stop_terminal", { employeeId });
}

export function employeeActivityList(): Promise<EmployeeActivity[]> {
  return invoke("employee_activity_list");
}

export function employeeActivityGet(employeeId: string): Promise<EmployeeActivity> {
  return invoke("employee_activity_get", { employeeId });
}

export function terminalSessionList(
  employeeId?: string | null,
): Promise<TerminalSessionRecord[]> {
  return invoke("terminal_session_list", { employeeId });
}

export function terminalSessionStop(
  employeeId: string,
  sessionId: string,
): Promise<TerminalSessionRecord> {
  return invoke("terminal_session_stop", { employeeId, sessionId });
}

export function terminalSessionRename(
  employeeId: string,
  sessionId: string,
  label: string,
): Promise<TerminalSessionRecord> {
  return invoke("terminal_session_rename", { employeeId, sessionId, label });
}

export function terminalWrite(
  employeeId: string,
  sessionId: string,
  input: string,
): Promise<void> {
  return invoke("terminal_write", { employeeId, sessionId, input });
}

export function terminalResize(
  employeeId: string,
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("terminal_resize", { employeeId, sessionId, cols, rows });
}

export function codexCliStatus(): Promise<CodexCliStatus> {
  return invoke("codex_cli_status");
}

export function diagnosticsSummary(): Promise<DiagnosticsSummary> {
  return invoke("diagnostics_summary");
}

export function diagnosticsExportBundle(): Promise<DiagnosticsExportBundle> {
  return invoke("diagnostics_export_bundle");
}

export function approvalList(): Promise<ApprovalRequest[]> {
  return invoke("approval_list", { filter: null });
}

export function approvalCreate(payload: CreateApprovalInput): Promise<ApprovalRequest> {
  return invoke("approval_create", { payload });
}

export function approvalApprove(approvalId: string): Promise<ApprovalRequest> {
  return invoke("approval_approve", { approvalId });
}

export function approvalReject(approvalId: string): Promise<ApprovalRequest> {
  return invoke("approval_reject", { approvalId });
}

export function actionList(): Promise<Action[]> {
  return invoke("action_list", { filter: null });
}

export function actionCreate(payload: CreateActionInput): Promise<Action> {
  return invoke("action_create", { payload });
}

export function actionRequestApproval(actionId: string): Promise<Action> {
  return invoke("action_request_approval", { actionId });
}

export function actionApprove(actionId: string): Promise<Action> {
  return invoke("action_approve", { actionId });
}

export function actionReject(actionId: string): Promise<Action> {
  return invoke("action_reject", { actionId });
}

export function actionRun(actionId: string): Promise<Action> {
  return invoke("action_run", { actionId });
}

export function actionCancel(actionId: string): Promise<Action> {
  return invoke("action_cancel", { actionId });
}

export function processList(): Promise<ManagedProcess[]> {
  return invoke("process_list");
}

export function processSpawn(payload: {
  employeeId: string | null;
  command: string;
  cwd: string;
  title?: string | null;
}): Promise<ManagedProcess> {
  return invoke("process_spawn", { payload });
}

export function processKill(processId: string): Promise<ManagedProcess> {
  return invoke("process_kill", { processId });
}

export function processLogs(processId: string, offset?: number | null): Promise<ProcessLogs> {
  return invoke("process_logs", { processId, offset });
}

export function gitWorktreeCreateForEmployee(employeeId: string): Promise<Employee> {
  return invoke("git_worktree_create_for_employee", { employeeId });
}

export function gitWorktreeRemoveForEmployee(employeeId: string): Promise<Employee> {
  return invoke("git_worktree_remove_for_employee", { employeeId });
}

export function gitWorktreeStatusForEmployee(employeeId: string): Promise<WorktreeStatus> {
  return invoke("git_worktree_status_for_employee", { employeeId });
}

export function gitWorktreeDiffForEmployee(employeeId: string): Promise<string> {
  return invoke("git_worktree_diff_for_employee", { employeeId });
}

export function gitWorktreeReviewForEmployee(employeeId: string): Promise<WorktreeReview> {
  return invoke("git_worktree_review_for_employee", { employeeId });
}

export function gitWorktreeLogForEmployee(
  employeeId: string,
  limit: number,
): Promise<WorktreeCommit[]> {
  return invoke("git_worktree_log_for_employee", { employeeId, limit });
}

export function gitWorktreeHandoffPreflightForEmployee(
  employeeId: string,
): Promise<WorktreeHandoffPreflight> {
  return invoke("git_worktree_handoff_preflight_for_employee", { employeeId });
}

export function gitWorktreeChangedFilesForEmployee(employeeId: string): Promise<string[]> {
  return invoke("git_worktree_changed_files_for_employee", { employeeId });
}

export function gitWorktreeFileDiffForEmployee(
  employeeId: string,
  path: string,
): Promise<string> {
  return invoke("git_worktree_file_diff_for_employee", { employeeId, path });
}

export function gitWorktreeStageFile(
  employeeId: string,
  path: string,
): Promise<WorktreeReview> {
  return invoke("git_worktree_stage_file", { employeeId, path });
}

export function gitWorktreeUnstageFile(
  employeeId: string,
  path: string,
): Promise<WorktreeReview> {
  return invoke("git_worktree_unstage_file", { employeeId, path });
}

export function gitWorktreeDiscardFileForEmployee(
  employeeId: string,
  path: string,
): Promise<WorktreeReview> {
  return invoke("git_worktree_discard_file_for_employee", { employeeId, path });
}

export function gitWorktreeDeleteUntrackedFileForEmployee(
  employeeId: string,
  path: string,
): Promise<WorktreeReview> {
  return invoke("git_worktree_delete_untracked_file_for_employee", { employeeId, path });
}

export function gitWorktreeCommitForEmployee(
  employeeId: string,
  message: string,
): Promise<WorktreeCommit> {
  return invoke("git_worktree_commit_for_employee", { payload: { employeeId, message } });
}

export function gitWorktreeApplyHandoffForEmployee(
  employeeId: string,
): Promise<WorktreeHandoffApplyResult> {
  return invoke("git_worktree_apply_handoff_for_employee", {
    payload: { employeeId, confirmed: true },
  });
}

export function gitWorktreeAbortHandoffForEmployee(
  employeeId: string,
): Promise<WorktreeHandoffAbortResult> {
  return invoke("git_worktree_abort_handoff_for_employee", { employeeId });
}

export function fsSearchFiles(
  mode: "search" | "grep" | "glob",
  query: string,
  root?: string | null,
): Promise<FsSearchResult[]> {
  const command =
    mode === "grep" ? "fs_grep" : mode === "glob" ? "fs_glob" : "fs_search";
  const payload =
    mode === "grep"
      ? { pattern: query, root, limit: 100 }
      : mode === "glob"
        ? { pattern: query, root, limit: 100 }
        : { query, root, limit: 100 };
  return invoke(command, payload);
}

export function fsCreateFile(path: string, contents: string): Promise<FilePayload> {
  return invoke("fs_create_file", { path, contents });
}

export function fsCreateDir(path: string): Promise<FsEntry> {
  return invoke("fs_create_dir", { path });
}

export function fsRename(from: string, to: string): Promise<FsEntry> {
  return invoke("fs_rename", { from, to });
}

export function fsDelete(path: string): Promise<void> {
  return invoke("fs_delete", { path });
}

export function fsListDir(path?: string | null): Promise<FsEntry[]> {
  return invoke("fs_list_dir", { path });
}

export function fsReadFile(path: string): Promise<FilePayload> {
  return invoke("fs_read_file", { path });
}

export function fsWriteFile(path: string, contents: string): Promise<void> {
  return invoke("fs_write_file", { path, contents });
}

export function fsFileMetadata(path: string): Promise<FileMetadata> {
  return invoke("fs_file_metadata", { path });
}
