import { useCallback, useMemo, useState } from "react";

import { useAppStore } from "../../store/appStore";
import type { Employee, EmployeeRole, PetVariant } from "../../types";
import {
  DEFAULT_OWNER_AVATAR_APPEARANCE,
  cycleAvatarAppearance,
  type OwnerAvatarAppearance,
  type OwnerAvatarAppearanceKey,
} from "../employee-floor/avatarAppearance";
import { createEmployeeFloorViewModels } from "../employee-floor/employeeFloorViewModel";
import {
  DEFAULT_OFFICE_COLOR_THEME,
  normalizeOfficeColorTheme,
  type OfficeColorTheme,
} from "../employee-floor/officeColorTheme";
import { presentEmployeeActivity } from "../employee-scene/activityPresentation";
import { handoffApplyDisabledReason } from "../panelUtils";

const roles: EmployeeRole[] = ["general", "frontend", "backend", "reviewer", "tester"];
const OFFICE_COLOR_THEME_STORAGE_KEY = "slavey.officeColorTheme";
const OFFICE_NAMEPLATE_SCALE_STORAGE_KEY = "slavey.officeNameplateScale";
const DEFAULT_OFFICE_NAMEPLATE_SCALE = 1;

export function useOfficeViewModel() {
  const employees = useAppStore((state) => state.employees);
  const employeeActivities = useAppStore((state) => state.employeeActivities);
  const selectedEmployeeId = useAppStore((state) => state.selectedEmployeeId);
  const terminalSessions = useAppStore((state) => state.terminalSessions);
  const approvals = useAppStore((state) => state.approvals);
  const actions = useAppStore((state) => state.actions);
  const processes = useAppStore((state) => state.processes);
  const worktreeReviews = useAppStore((state) => state.worktreeReviews);
  const worktreeHandoffs = useAppStore((state) => state.worktreeHandoffs);
  const worktreeChangedFiles = useAppStore((state) => state.worktreeChangedFiles);
  const workspaceInfo = useAppStore((state) => state.workspaceInfo);
  const settings = useAppStore((state) => state.settings);
  const createEmployee = useAppStore((state) => state.createEmployee);
  const createEmployeeCompanion = useAppStore((state) => state.createEmployeeCompanion);
  const removeEmployee = useAppStore((state) => state.removeEmployee);
  const setEmployeeStandby = useAppStore((state) => state.setEmployeeStandby);
  const resumeEmployeeFromStandby = useAppStore((state) => state.resumeEmployeeFromStandby);
  const selectEmployee = useAppStore((state) => state.selectEmployee);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const startTerminal = useAppStore((state) => state.startTerminal);
  const stopTerminalSession = useAppStore((state) => state.stopTerminalSession);
  const loadTerminalBuffer = useAppStore((state) => state.loadTerminalBuffer);
  const approveApproval = useAppStore((state) => state.approveApproval);
  const rejectApproval = useAppStore((state) => state.rejectApproval);
  const approveAction = useAppStore((state) => state.approveAction);
  const rejectAction = useAppStore((state) => state.rejectAction);
  const loadWorktreeReview = useAppStore((state) => state.loadWorktreeReview);
  const loadWorktreeHandoff = useAppStore((state) => state.loadWorktreeHandoff);
  const loadWorktreeChangedFiles = useAppStore((state) => state.loadWorktreeChangedFiles);
  const applyWorktreeHandoff = useAppStore((state) => state.applyWorktreeHandoff);
  const [name, setName] = useState("");
  const [role, setRole] = useState<EmployeeRole>("general");
  const [cwd, setCwd] = useState("");
  const [createModalSlotId, setCreateModalSlotId] = useState<string | null>(null);
  const [avatarCustomizerOpen, setAvatarCustomizerOpen] = useState(false);
  const [ownerName, setOwnerName] = useState("You");
  const [avatarAppearance, setAvatarAppearance] = useState<OwnerAvatarAppearance>(
    DEFAULT_OWNER_AVATAR_APPEARANCE,
  );
  const [officeColorTheme, setOfficeColorThemeState] = useState<OfficeColorTheme>(
    readStoredOfficeColorTheme,
  );
  const [nameplateScale, setNameplateScaleState] = useState(readStoredNameplateScale);
  const [terminalDockEmployeeId, setTerminalDockEmployeeId] = useState<string | null>(null);
  const [terminalDockExpanded, setTerminalDockExpanded] = useState(false);
  const personEmployees = useMemo(
    () => employees.filter((employee) => !isPetEmployee(employee)),
    [employees],
  );
  const companionCounts = useMemo(() => companionCountsByParent(employees), [employees]);
  const nextName = useMemo(
    () => `Employee ${personEmployees.length + 1}`,
    [personEmployees.length],
  );
  const workspaceRoot = workspaceInfo?.workspaceRoot ?? null;
  const cwdPlaceholder = workspaceRoot ?? "Workspace root";
  const stationModels = useMemo(
    () =>
      employees.map((employee) => ({
        employee,
        presentation: presentEmployeeActivity({
          employee,
          activity: employeeActivities[employee.id] ?? null,
          terminalSessions,
          approvals,
          actions,
          processes,
          review: worktreeReviews[employee.id] ?? null,
          handoff: worktreeHandoffs[employee.id] ?? null,
        }),
      })),
    [
      actions,
      approvals,
      employeeActivities,
      employees,
      processes,
      terminalSessions,
      worktreeHandoffs,
      worktreeReviews,
    ],
  );
  const floorViewModels = useMemo(
    () => createEmployeeFloorViewModels(stationModels, selectedEmployeeId, { includeStandby: true }),
    [selectedEmployeeId, stationModels],
  );
  const selectedFloorModel =
    floorViewModels.find((viewModel) => viewModel.kind === "employee" && viewModel.selected) ?? null;
  const selectedEmployee =
    selectedFloorModel && selectedFloorModel.kind === "employee"
      ? employees.find((employee) => employee.id === selectedFloorModel.id) ?? null
      : null;
  const selectedCompanionCount = selectedEmployee
    ? companionCounts.get(selectedEmployee.id) ?? 0
    : 0;
  const terminalDockEmployee =
    employees.find((employee) => employee.id === terminalDockEmployeeId) ?? null;
  const terminalDockSession = terminalDockEmployee?.terminalSessionId
    ? terminalSessions.find(
        (session) => session.sessionId === terminalDockEmployee.terminalSessionId,
      ) ?? null
    : null;
  const selectedEmployeeIdForContext = selectedFloorModel?.id ?? null;
  const pendingApproval = useMemo(
    () =>
      selectedEmployeeIdForContext
        ? approvals.find(
            (approval) =>
              approval.employeeId === selectedEmployeeIdForContext &&
              approval.status === "pending",
          ) ?? null
        : null,
    [approvals, selectedEmployeeIdForContext],
  );
  const pendingAction = useMemo(
    () =>
      selectedEmployeeIdForContext
        ? actions.find(
            (action) =>
              action.employeeId === selectedEmployeeIdForContext &&
              action.status === "pending_approval",
          ) ?? null
        : null,
    [actions, selectedEmployeeIdForContext],
  );
  const reviewHandoff = selectedEmployeeIdForContext
    ? worktreeReviews[selectedEmployeeIdForContext]?.handoff ??
      worktreeHandoffs[selectedEmployeeIdForContext] ??
      null
    : null;
  const handoffDisabledReason = handoffApplyDisabledReason(
    workspaceInfo?.repoHealth ?? null,
    reviewHandoff ?? undefined,
  );
  const selectedChangedFiles = selectedEmployeeIdForContext
    ? worktreeChangedFiles[selectedEmployeeIdForContext] ?? []
    : [];
  const submitCreateEmployee = useCallback(() => {
    const trimmedCwd = cwd.trim();
    void createEmployee({
      name: name.trim() || nextName,
      role,
      cwd: trimmedCwd || undefined,
    });
    setName("");
    setCwd("");
    setCreateModalSlotId(null);
  }, [createEmployee, cwd, name, nextName, role]);
  const closeCreateModal = useCallback(() => {
    setCreateModalSlotId(null);
  }, []);
  const handleSelectEmployee = useCallback(
    (actorId: string) => {
      const floorModel = floorViewModels.find((item) => item.id === actorId) ?? null;
      if (floorModel?.kind === "standby" || actorId.startsWith("standby:")) {
        setCreateModalSlotId(floorModel?.standbySlotId ?? actorId.replace(/^standby:/, ""));
        setTerminalDockEmployeeId(null);
        void selectEmployee(null);
        setName("");
        setRole("general");
        return;
      }

      setTerminalDockEmployeeId(actorId);
      const employee = employees.find((item) => item.id === actorId);
      if (employee?.terminalSessionId) {
        void loadTerminalBuffer(employee.id, employee.terminalSessionId);
      }
      void selectEmployee(actorId);
    },
    [employees, floorViewModels, loadTerminalBuffer, selectEmployee],
  );
  const releaseEmployee = useCallback(
    (employeeId: string) => {
      const employee = employees.find((item) => item.id === employeeId);
      if (!employee) return;
      if (employee.worktreePath) {
        window.alert("Remove or archive the employee worktree before releasing this employee.");
        return;
      }
      const companionCount = companionCounts.get(employeeId) ?? 0;
      if (companionCount > 0) {
        window.alert("Release attached pets before releasing this employee.");
        return;
      }
      const confirmed =
        !settings.requireConfirmationDelete ||
        window.confirm(`Release ${employee.name} and return this character to standby?`);
      if (!confirmed) return;
      if (terminalDockEmployeeId === employeeId) {
        setTerminalDockEmployeeId(null);
        setTerminalDockExpanded(false);
      }
      void removeEmployee(employeeId);
    },
    [
      companionCounts,
      employees,
      removeEmployee,
      settings.requireConfirmationDelete,
      terminalDockEmployeeId,
    ],
  );
  const createCompanionForEmployee = useCallback(
    (employeeId: string, petVariant: PetVariant) => {
      const parent = employees.find((employee) => employee.id === employeeId);
      if (!parent || isPetEmployee(parent)) {
        return;
      }
      void createEmployeeCompanion({
        parentEmployeeId: parent.id,
        petVariant,
      });
    },
    [createEmployeeCompanion, employees],
  );
  const setEmployeeOnStandby = useCallback(
    (employeeId: string) => {
      void setEmployeeStandby(employeeId);
    },
    [setEmployeeStandby],
  );
  const resumeStandbyEmployee = useCallback(
    (employeeId: string) => {
      void resumeEmployeeFromStandby(employeeId);
    },
    [resumeEmployeeFromStandby],
  );
  const handleSelectOfficeHotspot = useCallback((hotspotId: string) => {
    if (hotspotId === "avatar_customizer") {
      setAvatarCustomizerOpen(true);
    }
  }, []);
  const closeAvatarCustomizer = useCallback(() => {
    setAvatarCustomizerOpen(false);
  }, []);
  const cycleAvatarOption = useCallback((key: OwnerAvatarAppearanceKey, direction: -1 | 1) => {
    setAvatarAppearance((current) => cycleAvatarAppearance(current, key, direction));
  }, []);
  const openTerminalContext = useCallback(() => {
    if (selectedFloorModel) {
      setTerminalDockEmployeeId(selectedFloorModel.id);
      if (selectedFloorModel.terminalSessionId) {
        void loadTerminalBuffer(selectedFloorModel.id, selectedFloorModel.terminalSessionId);
      }
      void selectEmployee(selectedFloorModel.id);
    }
  }, [loadTerminalBuffer, selectEmployee, selectedFloorModel]);
  const openDetailsContext = useCallback(() => {
    if (selectedFloorModel) {
      void selectEmployee(selectedFloorModel.id);
    }
    setActiveTab("terminal");
  }, [selectEmployee, selectedFloorModel, setActiveTab]);
  const openEditorContext = useCallback(() => {
    if (selectedFloorModel) {
      void selectEmployee(selectedFloorModel.id);
    }
    setActiveTab("editor");
  }, [selectEmployee, selectedFloorModel, setActiveTab]);
  const openReviewContext = useCallback(() => {
    if (!selectedFloorModel) return;
    void selectEmployee(selectedFloorModel.id);
    if (selectedFloorModel.worktreePath) {
      void loadWorktreeReview(selectedFloorModel.id);
      void loadWorktreeHandoff(selectedFloorModel.id);
      void loadWorktreeChangedFiles(selectedFloorModel.id);
    }
    setActiveTab("editor");
  }, [
    loadWorktreeChangedFiles,
    loadWorktreeHandoff,
    loadWorktreeReview,
    selectEmployee,
    selectedFloorModel,
    setActiveTab,
  ]);
  const resolvePendingApproval = useCallback(
    (resolution: "approve" | "reject") => {
      if (selectedFloorModel) {
        void selectEmployee(selectedFloorModel.id);
      }
      if (pendingAction) {
        void (resolution === "approve" ? approveAction : rejectAction)(pendingAction.id);
        return;
      }
      if (pendingApproval) {
        void (resolution === "approve" ? approveApproval : rejectApproval)(pendingApproval.id);
      }
    },
    [
      approveAction,
      approveApproval,
      pendingAction,
      pendingApproval,
      rejectAction,
      rejectApproval,
      selectEmployee,
      selectedFloorModel,
    ],
  );
  const runApplyHandoff = useCallback(() => {
    if (!selectedFloorModel || !reviewHandoff?.canApply || handoffDisabledReason) {
      return;
    }
    void selectEmployee(selectedFloorModel.id);
    const targetBranch = reviewHandoff.mainBranch ?? "main workspace";
    const confirmed =
      !settings.requireConfirmationHandoffApply ||
      window.confirm(
        `Apply ${reviewHandoff.commitsToApply.length} commit(s) to ${targetBranch} with cherry-pick?\n\nThis will not push or remove the employee worktree.`,
      );
    if (confirmed) {
      void applyWorktreeHandoff(selectedFloorModel.id);
    }
  }, [
    applyWorktreeHandoff,
    handoffDisabledReason,
    reviewHandoff,
    selectEmployee,
    selectedFloorModel,
    settings.requireConfirmationHandoffApply,
  ]);
  const closeTerminalDock = useCallback(() => {
    setTerminalDockEmployeeId(null);
    setTerminalDockExpanded(false);
  }, []);
  const startShellTerminal = useCallback(
    (employeeId: string) => {
      void startTerminal(employeeId);
    },
    [startTerminal],
  );
  const stopTerminal = useCallback(
    (employeeId: string, sessionId: string) => {
      void stopTerminalSession(employeeId, sessionId);
    },
    [stopTerminalSession],
  );
  const toggleTerminalDockExpanded = useCallback(() => {
    setTerminalDockExpanded((expanded) => !expanded);
  }, []);
  const setOfficeColorTheme = useCallback((theme: OfficeColorTheme) => {
    setOfficeColorThemeState(theme);
    try {
      window.localStorage.setItem(OFFICE_COLOR_THEME_STORAGE_KEY, theme);
    } catch {
      // The live preference still updates even when storage is unavailable.
    }
  }, []);
  const setNameplateScale = useCallback((scale: number) => {
    const nextScale = normalizeNameplateScale(scale);
    setNameplateScaleState(nextScale);
    try {
      window.localStorage.setItem(OFFICE_NAMEPLATE_SCALE_STORAGE_KEY, String(nextScale));
    } catch {
      // The live preference still updates even when storage is unavailable.
    }
  }, []);

  return {
    avatarAppearance,
    avatarCustomizerOpen,
    closeAvatarCustomizer,
    closeCreateModal,
    closeTerminalDock,
    createModalOpen: createModalSlotId !== null,
    cycleAvatarOption,
    cwd,
    cwdPlaceholder,
    employeeCount: employees.length,
    floorViewModels,
    handleSelectEmployee,
    handleSelectOfficeHotspot,
    handoffDisabledReason,
    name,
    nameplateScale,
    nextName,
    officeColorTheme,
    openDetailsContext,
    openEditorContext,
    openReviewContext,
    openTerminalContext,
    ownerName,
    pendingAction,
    pendingApproval,
    selectedCompanionCount,
    releaseEmployee,
    reviewHandoff,
    role,
    roles,
    runApplyHandoff,
    selectedChangedFiles,
    selectedFloorModel,
    setOfficeColorTheme,
    setNameplateScale,
    createCompanionForEmployee,
    setEmployeeStandby: setEmployeeOnStandby,
    setName,
    setCwd,
    setOwnerName,
    setRole,
    startShellTerminal,
    stopTerminal,
    submitCreateEmployee,
    resumeEmployeeFromStandby: resumeStandbyEmployee,
    terminalDockEmployee,
    terminalDockExpanded,
    terminalDockSession,
    toggleTerminalDockExpanded,
    resolvePendingApproval,
    workspaceRoot,
  };
}

function isPetEmployee(employee: Employee): boolean {
  return employee.visualKind === "pet" || Boolean(employee.companionOfEmployeeId);
}

function companionCountsByParent(employees: Employee[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const employee of employees) {
    const parentId = employee.companionOfEmployeeId;
    if (isPetEmployee(employee) && parentId) {
      counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
    }
  }
  return counts;
}

function readStoredNameplateScale(): number {
  if (typeof window === "undefined") {
    return DEFAULT_OFFICE_NAMEPLATE_SCALE;
  }
  try {
    const stored = window.localStorage.getItem(OFFICE_NAMEPLATE_SCALE_STORAGE_KEY);
    return stored === null ? DEFAULT_OFFICE_NAMEPLATE_SCALE : normalizeNameplateScale(Number(stored));
  } catch {
    return DEFAULT_OFFICE_NAMEPLATE_SCALE;
  }
}

function normalizeNameplateScale(scale: number): number {
  return Number.isFinite(scale)
    ? Math.min(Math.max(scale, 0.7), 2.2)
    : DEFAULT_OFFICE_NAMEPLATE_SCALE;
}

function readStoredOfficeColorTheme(): OfficeColorTheme {
  if (typeof window === "undefined") {
    return DEFAULT_OFFICE_COLOR_THEME;
  }
  try {
    return normalizeOfficeColorTheme(window.localStorage.getItem(OFFICE_COLOR_THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_OFFICE_COLOR_THEME;
  }
}
