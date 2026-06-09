import * as commands from "../../lib/tauriCommands";
import {
  activitiesByEmployee,
  formatError,
  localLog,
} from "../helpers";
import type { AppStore, AppStoreSlice } from "../types";

type EmployeesSlice = Pick<
  AppStore,
  | "employees"
  | "employeeActivities"
  | "selectedEmployeeId"
  | "selectedEmployee"
  | "loadEmployeeActivities"
  | "refreshEmployeeActivity"
  | "createEmployee"
  | "createEmployeeCompanion"
  | "removeEmployee"
  | "selectEmployee"
  | "setEmployeeWorkingFolder"
  | "setEmployeeStandby"
  | "resumeEmployeeFromStandby"
  | "upsertEmployee"
>;

let activityRefreshSequence = 0;
let latestActivityListRequest = 0;
const latestEmployeeActivityRequest = new Map<string, number>();

export const createEmployeesSlice: AppStoreSlice<EmployeesSlice> = (set, get) => ({
  employees: [],
  employeeActivities: {},
  selectedEmployeeId: null,

  selectedEmployee: () => {
    const { employees, selectedEmployeeId } = get();
    return employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  },

  loadEmployeeActivities: async () => {
    const requestId = ++activityRefreshSequence;
    latestActivityListRequest = requestId;
    try {
      const activities = await commands.employeeActivityList();
      if (latestActivityListRequest !== requestId) {
        return;
      }
      const nextActivities = activitiesByEmployee(activities);
      set((state) => {
        const employeeActivities = { ...nextActivities };
        for (const [employeeId, activity] of Object.entries(state.employeeActivities)) {
          if ((latestEmployeeActivityRequest.get(employeeId) ?? 0) > requestId) {
            employeeActivities[employeeId] = activity;
          }
        }
        return { employeeActivities };
      });
    } catch (error) {
      if (latestActivityListRequest !== requestId) {
        return;
      }
      get().addLog(localLog("warn", `employee activity failed: ${formatError(error)}`));
    }
  },

  refreshEmployeeActivity: async (employeeId) => {
    const requestId = ++activityRefreshSequence;
    latestEmployeeActivityRequest.set(employeeId, requestId);
    try {
      const activity = await commands.employeeActivityGet(employeeId);
      if (
        latestEmployeeActivityRequest.get(employeeId) !== requestId ||
        latestActivityListRequest > requestId
      ) {
        return;
      }
      set((state) => ({
        employeeActivities: {
          ...state.employeeActivities,
          [activity.employeeId]: activity,
        },
      }));
    } catch {
      if (
        latestEmployeeActivityRequest.get(employeeId) !== requestId ||
        latestActivityListRequest > requestId
      ) {
        return;
      }
      set((state) => {
        const { [employeeId]: _removed, ...employeeActivities } = state.employeeActivities;
        return { employeeActivities };
      });
    }
  },

  createEmployee: async (input) => {
    try {
      const employee = await commands.employeeCreate(input);
      get().upsertEmployee(employee);
      set({ selectedEmployeeId: employee.id });
      await get().loadDir(employee.cwd);
      await get().persistUiState();
    } catch (error) {
      get().addLog(localLog("error", `create employee failed: ${formatError(error)}`));
    }
  },

  createEmployeeCompanion: async (input) => {
    try {
      const employee = await commands.employeeCompanionCreate(input);
      get().upsertEmployee(employee);
      void get().refreshEmployeeActivity(employee.id);
      await get().persistUiState();
    } catch (error) {
      get().addLog(localLog("error", `create pet failed: ${formatError(error)}`));
    }
  },

  removeEmployee: async (employeeId) => {
    try {
      await commands.employeeRemove(employeeId);
      set((state) => {
        const employees = state.employees.filter((employee) => employee.id !== employeeId);
        const { [employeeId]: _activity, ...employeeActivities } = state.employeeActivities;
        const selectedEmployeeId =
          state.selectedEmployeeId === employeeId ? null : state.selectedEmployeeId;
        return { employees, employeeActivities, selectedEmployeeId };
      });
      await get().persistUiState();
      const selected = get().selectedEmployee();
      await get().loadDir(selected?.cwd ?? get().workspaceRoot);
    } catch (error) {
      get().addLog(localLog("error", `remove employee failed: ${formatError(error)}`));
    }
  },

  selectEmployee: async (employeeId) => {
    set({ selectedEmployeeId: employeeId });
    if (!employeeId) {
      await get().loadDir(get().workspaceRoot);
      await get().persistUiState();
      return;
    }
    const employee = get().employees.find((item) => item.id === employeeId);
    if (employee) {
      await get().loadDir(employee.cwd);
    }
    await get().persistUiState();
  },

  setEmployeeWorkingFolder: async (employeeId, path) => {
    try {
      const employee = await commands.employeeSetWorkingFolder({ employeeId, path });
      get().upsertEmployee(employee);
      await get().loadDir(employee.cwd);
      await get().loadGitChangesForPath(employee.cwd);
      await get().persistUiState();
    } catch (error) {
      get().addLog(localLog("error", `set working folder failed: ${formatError(error)}`));
    }
  },

  setEmployeeStandby: async (employeeId) => {
    try {
      const employee = await commands.employeeSetStandby(employeeId);
      get().upsertEmployee(employee);
      void get().refreshEmployeeActivity(employee.id);
    } catch (error) {
      get().addLog(localLog("error", `standby failed: ${formatError(error)}`));
    }
  },

  resumeEmployeeFromStandby: async (employeeId) => {
    try {
      const employee = await commands.employeeResumeFromStandby(employeeId);
      get().upsertEmployee(employee);
      void get().refreshEmployeeActivity(employee.id);
    } catch (error) {
      get().addLog(localLog("error", `resume failed: ${formatError(error)}`));
    }
  },

  upsertEmployee: (employee) => {
    set((state) => {
      const exists = state.employees.some((item) => item.id === employee.id);
      const employees = exists
        ? state.employees.map((item) => (item.id === employee.id ? employee : item))
        : [...state.employees, employee];
      employees.sort((a, b) => a.createdAt - b.createdAt);
      return {
        employees,
        selectedEmployeeId: state.selectedEmployeeId,
      };
    });
  },
});
