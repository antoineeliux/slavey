import type { EmployeeActor } from "./createCharacter";

export type ActorMap = Map<string, EmployeeActor>;

export type ActorUpdateOptions = {
  elapsed: number;
  delta: number;
  reducedMotion: boolean;
};
