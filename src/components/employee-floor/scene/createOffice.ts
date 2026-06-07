import * as THREE from "three";

import type { FloorMaterials } from "./materials";
import {
  addDecorDetails,
  addLightingDetails,
  addPlants,
} from "./officeDecor";
import {
  addCafeteria,
  addDeskNeighborhood,
  addExecutiveOffice,
} from "./officeFurniture";
import {
  addFloorZones,
  addShell,
  addSurroundingRooms,
} from "./officeRoomShell";

export function createOffice(materials: FloorMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = "employee-floor-office";

  addShell(group, materials);
  addFloorZones(group, materials);
  addSurroundingRooms(group, materials);
  addDeskNeighborhood(group, materials);
  addExecutiveOffice(group, materials);
  addCafeteria(group, materials);
  addPlants(group, materials);
  addDecorDetails(group, materials);
  addLightingDetails(group, materials);

  return group;
}
