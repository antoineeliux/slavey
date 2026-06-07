export type OfficePoint2D = readonly [x: number, z: number];

export type OfficeRect = {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type OfficeRoomId =
  | "main"
  | "entertainment"
  | "cocktail_bar"
  | "lounge"
  | "cafeteria"
  | "meeting_left"
  | "meeting_right";

export type OfficeHallId =
  | "left_hall"
  | "right_hall"
  | "front_hall"
  | "back_hall"
  | "rear_hall";

export type OfficeWalkAreaId = OfficeRoomId | OfficeHallId;

export type OfficeStandbyRoomId = "entertainment" | "cocktail_bar" | "meeting_room";

export type OfficeWalkArea = OfficeRect & {
  id: OfficeWalkAreaId;
  kind: "room" | "hall";
};

export type OfficeDoorConnection = {
  id:
    | "main_left"
    | "main_right"
    | "main_back"
    | "main_front"
    | "entertainment"
    | "cocktail_bar"
    | "lounge"
    | "cafeteria"
    | "meeting_left"
    | "meeting_right";
  from: OfficeRoomId;
  to: OfficeHallId;
  inside: OfficePoint2D;
  outside: OfficePoint2D;
};

export type OfficeWalkObstacle = OfficeRect;

export type OfficeStandbySlot = {
  id: string;
  room: OfficeStandbyRoomId;
  position: OfficePoint2D;
  facing: number;
};

export type OfficeSocialCluster = {
  center: OfficePoint2D;
  slots: readonly OfficePoint2D[];
};

export const OFFICE_FLOOR = {
  width: 34.7,
  depth: 23.9,
  backZ: -11.8,
  buildingFootprint: {
    minX: -17.6,
    maxX: 17.6,
    minZ: -12.3,
    maxZ: 12.3,
  },
  mainRoomBounds: {
    minX: -10.6,
    maxX: 10.6,
    minZ: -5.75,
    maxZ: 3.55,
  },
} as const;

export const OFFICE_CORRIDOR_LINES = {
  leftHallX: -11.25,
  rightHallX: 11.25,
  frontHallZ: 4.35,
  backHallZ: -6.35,
  rearHallZ: -10.95,
  sideDoorZ: -0.5,
} as const;

export const OFFICE_HALL_IDS: readonly OfficeHallId[] = [
  "left_hall",
  "right_hall",
  "front_hall",
  "back_hall",
  "rear_hall",
];

export const OFFICE_ROOM_IDS: readonly OfficeRoomId[] = [
  "main",
  "entertainment",
  "cocktail_bar",
  "lounge",
  "cafeteria",
  "meeting_left",
  "meeting_right",
];

export const OFFICE_WALK_AREAS: readonly OfficeWalkArea[] = [
  { id: "main", kind: "room", minX: -10.25, maxX: 10.25, minZ: -5.35, maxZ: 3.2 },
  { id: "entertainment", kind: "room", minX: -16.1, maxX: -12.15, minZ: -10.25, maxZ: 3.55 },
  { id: "cocktail_bar", kind: "room", minX: 12.15, maxX: 16.1, minZ: -10.25, maxZ: 3.55 },
  { id: "lounge", kind: "room", minX: -15.35, maxX: -0.9, minZ: 5.55, maxZ: 11.2 },
  { id: "cafeteria", kind: "room", minX: 0.9, maxX: 15.35, minZ: 5.55, maxZ: 11.2 },
  { id: "meeting_left", kind: "room", minX: -9.55, maxX: -1.15, minZ: -10.55, maxZ: -7.15 },
  { id: "meeting_right", kind: "room", minX: 1.15, maxX: 9.55, minZ: -10.55, maxZ: -7.15 },
  { id: "left_hall", kind: "hall", minX: -11.62, maxX: -10.76, minZ: -10.95, maxZ: 4.7 },
  { id: "right_hall", kind: "hall", minX: 10.76, maxX: 11.62, minZ: -10.95, maxZ: 4.7 },
  { id: "front_hall", kind: "hall", minX: -11.62, maxX: 11.62, minZ: 4.02, maxZ: 4.78 },
  { id: "back_hall", kind: "hall", minX: -11.62, maxX: 11.62, minZ: -6.68, maxZ: -5.95 },
  { id: "rear_hall", kind: "hall", minX: -11.62, maxX: 11.62, minZ: -11.18, maxZ: -10.66 },
];

export const OFFICE_DOOR_CONNECTIONS: readonly OfficeDoorConnection[] = [
  { id: "main_left", from: "main", to: "left_hall", inside: [-10.25, -0.5], outside: [-11.25, -0.5] },
  { id: "main_right", from: "main", to: "right_hall", inside: [10.25, -0.5], outside: [11.25, -0.5] },
  { id: "main_back", from: "main", to: "back_hall", inside: [0, -5.35], outside: [0, -6.35] },
  { id: "main_front", from: "main", to: "front_hall", inside: [0, 3.2], outside: [0, 4.35] },
  { id: "entertainment", from: "entertainment", to: "left_hall", inside: [-12.15, -3.3], outside: [-11.25, -3.3] },
  { id: "cocktail_bar", from: "cocktail_bar", to: "right_hall", inside: [12.15, -3.3], outside: [11.25, -3.3] },
  { id: "lounge", from: "lounge", to: "front_hall", inside: [-8.25, 5.55], outside: [-8.25, 4.35] },
  { id: "cafeteria", from: "cafeteria", to: "front_hall", inside: [8.25, 5.55], outside: [8.25, 4.35] },
  { id: "meeting_left", from: "meeting_left", to: "rear_hall", inside: [-5.35, -10.55], outside: [-5.35, -10.95] },
  { id: "meeting_right", from: "meeting_right", to: "rear_hall", inside: [5.35, -10.55], outside: [5.35, -10.95] },
];

export const OFFICE_STATIC_WALK_OBSTACLES: readonly OfficeWalkObstacle[] = [
  { id: "executive-desk", minX: -14.08, maxX: -10.58, minZ: 7.5, maxZ: 9.25 },
  { id: "executive-sideboard", minX: -15.55, maxX: -12.85, minZ: 9.9, maxZ: 10.78 },
  { id: "executive-sofa", minX: -7.75, maxX: -3.95, minZ: 9.65, maxZ: 11.1 },
  { id: "entertainment-sofa-back", minX: -15.65, maxX: -13.05, minZ: 0.72, maxZ: 2.0 },
  { id: "entertainment-sofa-front", minX: -15.65, maxX: -13.05, minZ: -7.32, maxZ: -6.04 },
  { id: "entertainment-counter", minX: -13.95, maxX: -12.45, minZ: -8.35, maxZ: 1.75 },
  { id: "cocktail-bar", minX: 14.48, maxX: 16.28, minZ: -9.2, maxZ: 2.6 },
  { id: "meeting-left-table", minX: -7.92, maxX: -2.78, minZ: -9.7, maxZ: -8.0 },
  { id: "meeting-right-table", minX: 2.78, maxX: 7.92, minZ: -9.7, maxZ: -8.0 },
  { id: "cafeteria-service", minX: 4.62, maxX: 8.48, minZ: 6.3, maxZ: 7.9 },
  { id: "cafeteria-counter", minX: 6.35, maxX: 12.55, minZ: 9.3, maxZ: 10.48 },
  { id: "cafeteria-side-counter", minX: 11.56, maxX: 12.94, minZ: 6.85, maxZ: 10.25 },
  { id: "cafeteria-round-table-a", minX: 9.74, maxX: 10.78, minZ: 6.02, maxZ: 7.02 },
  { id: "cafeteria-round-table-b", minX: 10.38, maxX: 11.42, minZ: 6.7, maxZ: 7.7 },
  { id: "cafeteria-round-table-c", minX: 8.92, maxX: 9.98, minZ: 6.78, maxZ: 7.78 },
  { id: "cafeteria-round-table-d", minX: 8.2, maxX: 9.24, minZ: 6.08, maxZ: 7.08 },
];

export const OFFICE_DESK_LAYOUT = {
  columns: 4,
  xStart: -7.25,
  xSpacing: 4.75,
  frontRowZ: -3.1,
  rearRowZ: 0.78,
  bandSize: 8,
  bandOffsetStep: 0.46,
  cafeteria: {
    xStart: 4.55,
    xSpacing: 1.06,
    zStart: 4.42,
    zRowSpacing: 0.72,
  },
} as const;

export const OFFICE_STANDBY_SLOTS: readonly OfficeStandbySlot[] = [
  { id: "entertainment-1", room: "entertainment", position: [-14.25, -7.4], facing: Math.PI * 0.5 },
  { id: "entertainment-2", room: "entertainment", position: [-14.25, -3.3], facing: Math.PI * 0.5 },
  { id: "entertainment-3", room: "entertainment", position: [-14.25, 2.65], facing: Math.PI * 0.5 },
  { id: "cocktail-bar-1", room: "cocktail_bar", position: [14.25, -7.4], facing: -Math.PI * 0.5 },
  { id: "cocktail-bar-2", room: "cocktail_bar", position: [14.25, -3.3], facing: -Math.PI * 0.5 },
  { id: "cocktail-bar-3", room: "cocktail_bar", position: [14.25, 0.8], facing: -Math.PI * 0.5 },
  { id: "meeting-left-1", room: "meeting_room", position: [-7.35, -7.55], facing: Math.PI },
  { id: "meeting-left-2", room: "meeting_room", position: [-3.35, -10.08], facing: 0 },
  { id: "meeting-right-1", room: "meeting_room", position: [3.35, -7.55], facing: Math.PI },
  { id: "meeting-right-2", room: "meeting_room", position: [7.35, -10.08], facing: 0 },
];

export const OFFICE_EXECUTIVE_QUEUE_POINTS: readonly OfficePoint2D[] = [
  [-5.2, 8.0],
  [-6.45, 8.0],
  [-7.7, 8.0],
  [-8.95, 8.0],
  [-10.2, 8.0],
  [-5.2, 9.55],
  [-6.45, 9.55],
  [-7.7, 9.55],
  [-8.95, 9.55],
  [-10.2, 9.55],
];

export const OFFICE_DONE_ROOM_POINTS: readonly OfficePoint2D[] = [
  [4.25, 7.25],
  [4.9, 8.75],
  [6.1, 8.35],
  [8.45, 8.22],
  [9.95, 8.42],
  [10.95, 8.25],
  [13.35, 8.75],
  [13.25, 10.15],
];

export const OFFICE_WANDER_POINTS_MANIFEST: readonly OfficePoint2D[] = [
  [-14.25, -7.4],
  [-14.25, -3.3],
  [-14.25, 2.65],
  [-11.25, -8.55],
  [-11.25, -0.5],
  [-11.25, 3.25],
  [-8.5, -7.65],
  [8.5, -7.65],
  [14.25, -7.4],
  [14.25, -3.3],
  [8.25, 8.55],
  [13.35, 7.45],
  [0, 4.35],
];

export const CAFETERIA_WANDER_POINTS_MANIFEST: readonly OfficePoint2D[] = [
  [14.25, -7.4],
  [14.25, -3.3],
  [14.25, 0.8],
  [11.25, -8.55],
  [11.25, -0.5],
  [11.25, 3.25],
  [4.25, 7.65],
  [8.25, 8.55],
  [10.4, 8.05],
  [13.35, 7.45],
];

export const OFFICE_SOCIAL_CLUSTERS_MANIFEST: {
  readonly office: readonly OfficeSocialCluster[];
  readonly cafeteria: readonly OfficeSocialCluster[];
} = {
  office: [
    {
      center: [-14.25, -3.3],
      slots: [[-14.25, -4.15], [-14.25, -2.45]],
    },
    {
      center: [-7.6, -7.65],
      slots: [[-8.45, -7.65], [-6.75, -7.65]],
    },
  ],
  cafeteria: [
    {
      center: [14.25, -3.3],
      slots: [[14.25, -4.15], [14.25, -2.45]],
    },
    {
      center: [8.25, 8.55],
      slots: [[7.55, 8.2], [9.05, 8.88]],
    },
  ],
};
