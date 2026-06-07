import * as THREE from "three";

import {
  OFFICE_CORRIDOR_LINES,
  OFFICE_DOOR_CONNECTIONS,
  type OfficeDoorConnection,
} from "./officeLayoutManifest";
import {
  closestPointInAreas,
  corridorArea,
  isCorridorPoint,
  WALKABLE_AREAS,
} from "./navigationAreas";
import {
  near,
  point,
  pointFromManifest,
  samePoint2D,
  type WalkArea,
  type WalkAreaId,
} from "./navigationTypes";

type DoorConnection = Omit<OfficeDoorConnection, "inside" | "outside"> & {
  inside: THREE.Vector3;
  outside: THREE.Vector3;
};

const DOOR_CONNECTIONS: DoorConnection[] = OFFICE_DOOR_CONNECTIONS.map((door) => ({
  ...door,
  inside: pointFromManifest(door.inside),
  outside: pointFromManifest(door.outside),
}));

export const DOOR_POINTS = DOOR_CONNECTIONS.flatMap((door) => [
  door.inside.clone(),
  door.outside.clone(),
]);

const DOOR_BY_ID = new Map(DOOR_CONNECTIONS.map((door) => [door.id, door]));
const DOOR_BY_ROOM = new Map<WalkAreaId, DoorConnection>(
  DOOR_CONNECTIONS.filter((door) => door.from !== "main").map((door) => [door.from, door]),
);

export function isDoorwayOrCorridorPoint(pointValue: THREE.Vector3): boolean {
  if (isCorridorPoint(pointValue)) return true;
  return DOOR_POINTS.some((door) => samePoint2D(door, pointValue, 0.9));
}

export function exitToCorridor(
  start: THREE.Vector3,
  area: WalkArea | null,
  destination: THREE.Vector3,
): { corridor: THREE.Vector3; waypoints: THREE.Vector3[] } {
  if (!area || corridorArea(area.id)) {
    const corridor = projectToCorridor(start);
    return { corridor, waypoints: [corridor] };
  }

  if (area.id === "main") {
    const door = mainDoorToward(destination);
    return { corridor: door.outside, waypoints: [door.inside, door.outside] };
  }

  const door = roomDoor(area.id);
  return { corridor: door.outside, waypoints: [door.inside, door.outside] };
}

export function entryFromCorridor(
  destination: THREE.Vector3,
  area: WalkArea | null,
  start: THREE.Vector3,
): { corridor: THREE.Vector3; waypoints: THREE.Vector3[] } {
  if (!area || corridorArea(area.id)) {
    const corridor = projectToCorridor(destination);
    return { corridor, waypoints: [destination] };
  }

  if (area.id === "main") {
    const door = mainDoorToward(start);
    return { corridor: door.outside, waypoints: [door.inside] };
  }

  const door = roomDoor(area.id);
  return { corridor: door.outside, waypoints: [door.inside] };
}

export function corridorRoute(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
  if (samePoint2D(from, to, 0.08)) return [];
  if (sameCorridorLine(from, to)) return [to];

  const transitZ = corridorTransitZ(from, to);
  return compactDoorPath([point(from.x, transitZ), point(to.x, transitZ), to]);
}

function mainDoorToward(target: THREE.Vector3): { inside: THREE.Vector3; outside: THREE.Vector3 } {
  if (target.x < -10.75) {
    return doorPoints("main_left");
  }
  if (target.x > 10.75) {
    return doorPoints("main_right");
  }
  if (target.z < -5.75) {
    return doorPoints("main_back");
  }
  return doorPoints("main_front");
}

function roomDoor(areaId: WalkAreaId): { inside: THREE.Vector3; outside: THREE.Vector3 } {
  const door = DOOR_BY_ROOM.get(areaId);
  return door ? cloneDoorPoints(door) : doorPoints("main_front");
}

function corridorTransitZ(from: THREE.Vector3, to: THREE.Vector3): number {
  if (from.z < -9.1 || to.z < -9.1) return OFFICE_CORRIDOR_LINES.rearHallZ;
  if (from.z < -5.75 || to.z < -5.75) return OFFICE_CORRIDOR_LINES.backHallZ;
  if (from.z > 3.7 || to.z > 3.7) return OFFICE_CORRIDOR_LINES.frontHallZ;
  return OFFICE_CORRIDOR_LINES.frontHallZ;
}

function sameCorridorLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
  if (
    Math.abs(a.x - b.x) < 0.12 &&
    (near(a.x, OFFICE_CORRIDOR_LINES.leftHallX) ||
      near(a.x, OFFICE_CORRIDOR_LINES.rightHallX))
  ) {
    return true;
  }
  return (
    Math.abs(a.z - b.z) < 0.12 &&
    (near(a.z, OFFICE_CORRIDOR_LINES.frontHallZ) ||
      near(a.z, OFFICE_CORRIDOR_LINES.backHallZ) ||
      near(a.z, OFFICE_CORRIDOR_LINES.rearHallZ))
  );
}

function projectToCorridor(source: THREE.Vector3): THREE.Vector3 {
  const corridorAreas = WALKABLE_AREAS.filter((area) => corridorArea(area.id));
  return closestPointInAreas(source, corridorAreas);
}

function compactDoorPath(points: THREE.Vector3[]): THREE.Vector3[] {
  const compact: THREE.Vector3[] = [];
  for (const entry of points) {
    const previous = compact.at(-1);
    if (!previous || !samePoint2D(previous, entry, 0.08)) {
      compact.push(entry);
    }
  }
  return compact;
}

function doorPoints(id: OfficeDoorConnection["id"]): { inside: THREE.Vector3; outside: THREE.Vector3 } {
  const door = DOOR_BY_ID.get(id);
  if (!door) return { inside: point(0, 0), outside: point(0, 0) };
  return cloneDoorPoints(door);
}

function cloneDoorPoints(door: DoorConnection): { inside: THREE.Vector3; outside: THREE.Vector3 } {
  return { inside: door.inside.clone(), outside: door.outside.clone() };
}
