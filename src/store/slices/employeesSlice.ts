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
  | "removeEmployee"
  | "selectEmployee"
  | "upsertEmployee"
>;

export const createEmployeesSlice: AppStoreSlice<EmployeesSlice> = (set, get) => ({
  employees: [],
  employeeActivities: {},
  selectedEmployeeId: null,

  selectedEmployee: () => {
    const { employees, selectedEmployeeId } = get();
    return employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  },

  loadEmployeeActivities: async () => {
    try {
      const activities = await commands.employeeActivityList();
      set({ employeeActivities: activitiesByEmployee(activities) });
    } catch (error) {
      get().addLog(localLog("warn", `employee activity failed: ${formatError(error)}`));
    }
  },

  refreshEmployeeActivity: async (employeeId) => {
    try {
      const activity = await commands.employeeActivityGet(employeeId);
      set((state) => ({
        employeeActivities: {
          ...state.employeeActivities,
          [activity.employeeId]: activity,
        },
      }));
    } catch {
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

  removeEmployee: async (employeeId) => {
    try {
      await commands.employeeRemove(employeeId);
      set((state) => {
        const employees = state.employees.filter((employee) => employee.id !== employeeId);
        const { [employeeId]: _activity, ...employeeActivities } = state.employeeActivities;
        const selectedEmployeeId =
          state.selectedEmployeeId === employeeId
            ? employees[0]?.id ?? null
            : state.selectedEmployeeId;
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
    const employee = get().employees.find((item) => item.id === employeeId);
    if (employee) {
      await get().loadDir(employee.cwd);
    }
    await get().persistUiState();
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
        selectedEmployeeId: state.selectedEmployeeId ?? employee.id,
      };
    });
  },
});
