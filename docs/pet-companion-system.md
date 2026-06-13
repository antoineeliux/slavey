# Pet Companion System

Status: v1 implementation baseline. Future detach, re-parent, and repair flows are noted as follow-up extensions.

## Goal

The pet companion system creates a dependent employee that helps another employee without becoming visually independent on the office floor.

The companion should behave like a normal employee in backend terms:

- It has its own employee id, status, cwd, terminal session, Codex session, actions, approvals, managed processes, logs, and activity record.
- It can later run a terminal or agent session like any other employee.
- It does not share or fork the parent employee's active terminal session.
- It is created idle: no shell, no Codex task, and no default prompt are started automatically.

The companion should behave differently only in presentation terms:

- It renders as a pet-style companion.
- It follows a parent employee instead of routing itself to a desk, owner office, done room, standby, or offline zone.
- Its own backend activity controls status, animation, marker color, attention indicators, and terminal/HUD state, but not its floor destination.

## Current System Audit

The current code already has most of the backend infrastructure needed for a companion because employees are independent units of work.

Current employee records live in `src-tauri/src/employees.rs` and `src/types.ts`. They contain identity, role, status, cwd, optional worktree metadata, optional active terminal session id, current command, and timestamps. There is no current parent/companion relationship field.

Activity is derived per employee in `src-tauri/src/activity.rs`. Evidence is filtered by `employee.id` for actions, approvals, managed processes, terminal sessions, agent runtime snapshots, review state, handoff state, blockers, and lifecycle state. The derived `EmployeeActivity` contains both compatibility fields and the canonical `contract`.

The canonical activity contract is resolved in `src-tauri/src/activity_contract.rs`. It maps evidence into:

- `lifecycle`
- `work.kind`
- `work.phase`
- `work.turnOwner`
- `render.placement`
- `render.posture`
- `render.activity`
- `attention`
- `source`

Frontend presentation consumes that contract through `src/lib/employeeActivityContractView.ts`, then `src/components/employee-scene/activityPresentation.ts`, then `src/components/employee-floor/employeeFloorViewModel.ts`.

The office floor currently routes every employee independently. `src/components/employee-floor/scene/characterBehavior.ts` maps `officeState` to a location and activity. `src/components/employee-floor/scene/updateActors.ts` updates every actor from its own view model. `src/components/employee-floor/scene/actorMovement.ts` computes the destination through `targetForActor`.

That means a naive "pet is just an employee" implementation would be wrong visually. The pet would route itself to its own desk, owner office queue, done room, standby area, or offline zone.

## Design Principle

Do not create a second state machine for pet work.

The companion should reuse the existing employee backend state machine and activity contract. The only override is floor routing.

The split should be:

| Concern | Source |
| --- | --- |
| Work state | Companion employee's own backend activity contract |
| Agent/session/process ownership | Companion employee id |
| Terminal dock and logs | Companion employee id |
| Attention and blocked/done status | Companion employee's own activity |
| Office floor destination | Parent employee actor plus a follow offset |
| Office floor mesh | Pet-specific actor factory |

This keeps backend state canonical while allowing the companion to feel subordinate in the office.

## Proposed Data Model

Extend `Employee` with durable companion metadata:

```ts
type EmployeeVisualKind = "person" | "pet";
type PetVariant = "dog" | "cat" | "robot";

type Employee = {
  id: string;
  name: string;
  role: EmployeeRole;
  status: EmployeeStatus;
  cwd: string;
  worktreePath?: string | null;
  branchName?: string | null;
  terminalSessionId?: string | null;
  currentCommand?: string | null;
  visualKind?: EmployeeVisualKind;
  companionOfEmployeeId?: string | null;
  petVariant?: PetVariant | null;
  createdAt: number;
  updatedAt: number;
};
```

Rust should mirror these fields in `employees.rs`:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeVisualKind {
    Person,
    Pet,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PetVariant {
    Dog,
    Cat,
    Robot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Employee {
    pub id: String,
    pub name: String,
    pub role: EmployeeRole,
    pub status: EmployeeStatus,
    pub cwd: String,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub terminal_session_id: Option<String>,
    pub current_command: Option<String>,
    #[serde(default = "default_employee_visual_kind")]
    pub visual_kind: EmployeeVisualKind,
    #[serde(default)]
    pub companion_of_employee_id: Option<String>,
    #[serde(default)]
    pub pet_variant: Option<PetVariant>,
    pub created_at: u64,
    pub updated_at: u64,
}
```

Defaulting `visualKind` to `person` keeps old persisted state compatible.

## Backend Commands

Add a dedicated command instead of overloading ordinary employee creation:

```ts
type EmployeeCompanionCreateInput = {
  parentEmployeeId: string;
  name?: string;
  role?: EmployeeRole;
  petVariant?: PetVariant;
};
```

Proposed Tauri commands:

- `employee_companion_create(payload) -> Employee`
- `employee_companion_detach(employeeId) -> Employee`
- `employee_companion_set_parent(employeeId, parentEmployeeId) -> Employee`

V1 can start with only `employee_companion_create` and parent-remove safety.

Creation rules:

- Parent employee must exist.
- Companion cannot be its own parent.
- Parent must not be a companion in v1, unless nested companions are explicitly designed later.
- Multiple companions per parent are allowed.
- Default `cwd` should be the parent employee's current execution directory.
- Creation must not start a shell, Codex session, managed process, or default prompt.
- `visualKind` must be `pet`.
- `companionOfEmployeeId` must be the parent id.

## Parent Removal And Restore Rules

The companion relationship must not create orphan pets.

Parent removal should be blocked while attached companions exist, unless a dedicated cascade-release command is added with explicit confirmation. This matches the current safety style where employee removal is blocked for worktree-backed employees.

On persistence restore:

- Validate that every `companionOfEmployeeId` points to an existing employee.
- If the parent is missing, keep the companion stopped and surface a blocker or clear the invalid relation through a dedicated repair path.
- Do not silently convert a pet into an ordinary independent employee.

This preserves the product rule that companions do not have independent office identity.

## Activity Contract Handling

Do not add pet-specific activity statuses for ordinary work states.

A companion running Codex should still resolve to `codex_running`. A companion waiting for owner input should still resolve to `codex_waiting_instruction`. A companion blocked by setup failure should still resolve to `blocked`.

The existing contract remains canonical for:

- status labels
- attention state
- terminal dock state
- context actions
- marker colors
- blocked/done/running indicators

The only companion-specific rule is in floor presentation:

```ts
if (viewModel.visualKind === "pet" && viewModel.companionOfEmployeeId) {
  // Ignore contract.render.placement for destination.
  // Keep contract-derived activity/status for animation and indicators.
}
```

This avoids frontend-only inference about work state while still overriding dependent movement.

## Frontend Store And Commands

Add typed command wrappers in `src/lib/tauriCommands.ts`:

- `employeeCompanionCreate`
- `employeeCompanionDetach`, if implemented
- `employeeCompanionSetParent`, if implemented

Add store actions to `src/store/slices/employeesSlice.ts`:

- `createCompanionEmployee(parentEmployeeId, options)`
- optionally `detachCompanionEmployee(employeeId)`

The frontend should continue loading activities through the existing activity flow. Since the companion is a normal employee record, `employee_activity_list` and `employee_activity_get` should work without a separate companion activity endpoint.

## Office UX

Parent employee HUD:

- Add a pet/companion button to `OfficeStatusHud`.
- Clicking it opens companion creation or a compact companion list.
- The parent HUD should not show an individual pet's panel just because the parent is selected.
- Existing companions should remain separately selectable actors on the floor.

Companion HUD:

- Selecting the pet should show the companion's own status, cwd, terminal, approvals, logs, and release action.
- The UI should clearly show "Companion of <parent name>".

Terminal dock:

- Reuse `OfficeTerminalDock` with the companion employee.
- The companion has its own `terminalSessionId`.
- Starting/stopping shell or Codex work manually must use the companion employee id.

## Floor Rendering

Extend `EmployeeFloorViewModel` with:

```ts
visualKind: "person" | "pet";
companionOfEmployeeId: string | null;
occupiesDesk: boolean;
```

`occupiesDesk` should be `false` for companions. This prevents companions from creating extra desks or marking desks active even when their contract says `render.placement: "desk"`.

Rendering changes:

1. Keep companions in the same `viewModels` array so picking, selection, nameplates, and status markers still work.
2. Add a pet actor factory instead of using the human `createCharacter` mesh.
3. Generalize actor types where needed from `EmployeeActor` to a floor actor union, or keep the existing actor type if the pet actor provides compatible fields.
4. During `updateActors`, build the parent actor map before movement.
5. For companion actors, compute a destination from the parent actor position plus a deterministic follow offset.
6. Move the companion toward that destination.
7. Use the companion's own contract-derived state for pose/effects:
   - working: alert/focused follow animation
   - waiting owner/approval: attention marker
   - waiting approval: jump or bounce in place near the parent, never route independently to the owner office
   - blocked: blocked marker
   - done: done marker
   - idle: relaxed follow animation

Companion follow behavior should not call ordinary `targetForActor` unless the parent actor is missing.

Parent missing fallback:

- If the parent actor is missing but the parent employee still exists, place the companion near the parent's expected spawn/desk target.
- If the parent employee is missing, show the companion as blocked/offline and expose a repair action instead of letting it roam independently.

## Worktree And CWD Policy

V1 companions do not create or request separate worktrees.

The companion's `cwd` should default to the parent employee's current execution directory at creation time. There is no v1 folder picker because creation does not start shell or Codex work. If the user later opens the companion terminal, it uses the companion's own stored cwd like any other employee.

Do not silently create a new worktree in v1. Worktree creation should remain explicit because it changes Git state and affects handoff/review flows.

## Implementation Plan

The safest implementation order is data contract first, then command plumbing, then a minimal visible pet, then richer animation and workflow polish. Avoid starting with a large animation pass before the backend relationship is durable.

### Phase 0: Product And UX Contract

Define the v1 companion rules before writing runtime code.

- V1 allows multiple companions per parent.
- Creating a companion does not start Codex, shell, managed processes, or a default prompt.
- Companion cwd defaults to the parent employee's current execution directory.
- Parent removal is blocked while attached companions exist.
- Initial pet variants are `dog`, `cat`, and `robot`.
- Minimal animation states are idle, follow, working, waiting owner, waiting approval, blocked, and done.

Deliverable:

- The decisions above are reflected in this document before runtime code changes.

### Phase 1: Durable Data Model

Add companion metadata without changing visual behavior yet.

- Add `EmployeeVisualKind` to Rust and TypeScript.
- Add `visualKind`, `companionOfEmployeeId`, and `petVariant` fields to `Employee`.
- Default old persisted employees to `visualKind: "person"` and `companionOfEmployeeId: null`.
- Add restore validation for missing or invalid parent ids.
- Add helper selectors on the frontend for `companionsForEmployee(parentId)` and `parentForCompanion(companionId)`.
- Keep the existing `EmployeeActivity.contract` unchanged.

Tests:

- Rust persistence tests for old snapshots, valid companion restore, and invalid parent restore behavior.
- TypeScript tests for companion selectors.

Definition of done:

- Existing employees restore unchanged.
- A companion record can exist in memory and persistence without affecting floor routing.

### Phase 2: Backend Companion Lifecycle

Add backend commands and relationship safety.

- Add `employee_companion_create`.
- Validate parent existence.
- Reject self-parenting.
- Reject companion parentage in v1 if nested companions are not allowed.
- Allow multiple companions per parent.
- Resolve companion cwd with existing backend workspace/path safety.
- Emit `employee:updated` and `employee:activity-updated` for the companion and parent.
- Block parent removal while attached companions exist.
- Decide release semantics for companions. Recommendation: a companion can be released like an employee, but the UI labels it as releasing the companion.

Tests:

- Backend creation validation.
- Parent removal blocked with attached companion.
- Companion removal does not remove parent.
- Companion creation persists expected metadata.

Definition of done:

- Companion records can be created and removed safely through backend commands.
- No Codex or visual behavior is attached yet.

### Phase 3: Agent Session Integration

Keep the companion separate from the parent when the user later starts shell or Codex work.

- Add typed command wrappers in `src/lib/tauriCommands.ts`.
- Add store action `createCompanionEmployee`.
- Creation must not call shell start, Codex task submit, or process spawn.
- If the user manually starts shell or Codex from the selected companion, use the companion employee id.
- Ensure the parent employee's `terminalSessionId` is never touched by companion terminal or agent startup.
- Refresh companion activity after manual session changes through the existing activity flow.

Tests:

- Store test for creating a companion and upserting returned employee.
- Backend or mocked command test proving companion session id belongs to the companion, not the parent.
- Activity test proving a newly created companion is idle but follows its parent in the floor model.
- Activity test for a companion manually running Codex still resolving to ordinary `codex_running`.

Definition of done:

- A companion starts idle.
- Later shell or Codex work is owned by the companion, not the parent.

### Phase 4: Office UI Entry Points

Expose the workflow without changing floor movement yet.

- Add a companion action to `OfficeStatusHud`.
- Show companion count or a compact companion launcher under the parent in the selected employee HUD.
- Add a compact companion creation UI:
  - pet variant picker
  - optional name
  - no cwd picker in v1
  - no start-now toggle in v1
  - no startup prompt in v1
- Selecting the companion should open its own status and terminal dock.
- Reuse `OfficeTerminalDock` for the companion employee.
- Selecting the parent must not open an individual companion's panel.

Tests:

- Component test for showing create button when no companion exists.
- Component test for showing existing companion action.
- Store/component test for opening the companion terminal dock.

Definition of done:

- Users can create and select a companion from the office UI.
- Clicking a parent can create/list companions, but only clicking a pet opens that pet's own panel.
- The companion still renders as a normal employee until later phases.

### Phase 5: Floor View Model Split

Teach the floor that companions are employees with dependent presentation.

- Extend `EmployeeFloorViewModel` with:
  - `visualKind`
  - `petVariant`
  - `companionOfEmployeeId`
  - `occupiesDesk`
  - `followTargetEmployeeId`
- Set `occupiesDesk: false` for companions.
- Exclude companions from active desk ownership.
- Do not create extra desks just because companions exist.
- Keep companions in the view model list for selection, markers, nameplates, and terminal/status actions.
- Preserve contract-derived labels, details, marker colors, attention, blockers, and terminal state.

Tests:

- Floor view model test for person employee desk ownership.
- Floor view model test for companion not occupying a desk even while `codex_running`.
- Floor view model test for companion retaining blocked/waiting/done labels from its own activity.

Definition of done:

- Companion view models carry both independent work state and dependent floor metadata.

### Phase 6: Pet Actor Foundation

Add the visual pet layer with stable dimensions and variant support.

- Add a `PetVariant` type, initially `dog`, `cat`, and `robot`.
- Add `createPetActor` or a generalized actor factory that returns the same runtime fields needed by selection, markers, nameplates, and movement.
- Keep pet meshes lightweight and built from Three.js primitives.
- Give each variant a distinct silhouette:
  - dog: compact body, upright ears, wagging tail
  - cat: slimmer body, pointed ears, curved tail
  - robot: small body, antenna or screen face, subtle emissive accent
- Keep selection hit targets predictable and larger than the visible pet mesh.
- Reuse status marker and nameplate scaling.
- Keep variant color/accessory choices deterministic from employee id unless user customization is added later.

Tests:

- Actor factory test or runtime smoke test that pet actors provide required fields.
- Render test that pet companions still have selectable targets and status markers.

Definition of done:

- Companions render as pets and can still be selected.
- No follow behavior yet beyond appearing in the scene.

### Phase 7: Follow Movement

Override only companion destination, not companion work state.

- Build an actor lookup by employee id in `updateActors`.
- For companion actors, find the parent actor through `followTargetEmployeeId`.
- Compute a deterministic follow offset from parent position and companion id.
- Use a small orbit/slot system so multiple companions around the same parent do not overlap.
- Smoothly chase the follow target with a pet-specific speed curve.
- Keep the companion near the parent when the parent walks, but avoid constant jitter when the parent is idle.
- If the parent actor is missing, use a safe fallback near the parent's expected floor target.
- If the parent employee is missing, render the companion as blocked/offline and expose repair UI.
- Support reduced motion by placing the companion directly at the follow target with idle pose.

Tests:

- Movement unit test for follow target calculation.
- Movement test that companion destination ignores ordinary `targetForActor`.
- Reduced-motion test.
- Missing-parent fallback test.

Definition of done:

- Pets follow their parent and do not independently route to desks, owner office, done room, standby, or offline zones.

### Phase 8: Activity-Driven Pet Animation

Map existing companion activity to pet-specific animation, without new backend states.

- Use the companion's own contract-derived state for animation:
  - idle: relaxed breathing or looking around
  - shell/process running: alert sit or small device/screen effect
  - codex starting: perk-up/startup loop
  - codex running/action running: focused trot or working pulse
  - waiting instruction: look alert near the parent
  - waiting approval: jump or bounce near the parent, without leaving follow mode
  - review/handoff/done: proud or completed idle
  - blocked/failed: low-energy blocked posture
  - stopped: dim/offline posture near parent or safe fallback
- Keep marker color and attention priority tied to the existing activity contract.
- Avoid UI text explaining animations in-app; use tooltips only where controls need names.
- Ensure animations do not resize the selection target or nameplate layout.

Tests:

- Character/pet behavior tests for key activity states.
- Visual smoke test after implementation for nonblank pet rendering and selection.

Definition of done:

- Pet animations communicate status while backend activity remains canonical.

### Phase 9: Companion Management Polish

Make the workflow comfortable for repeated daily use.

- Add companion rename if ordinary employee rename exists or is added.
- Add pet variant switcher if the creation choice needs to be changed later.
- Add manual shell/Codex controls from the companion HUD only if those controls are already available for ordinary employees.
- Add stop all companion work action if it owns both agent session and managed processes.
- Add visible parent link in companion status.
- Add visible companion link in parent status.
- Add diagnostics fields for companion relationship and pet variant after redaction review.

Tests:

- Component tests for management actions.
- Diagnostics redaction test.
- Store tests for relationship updates.

Definition of done:

- A companion can be created, started, selected, inspected, stopped, and released without hidden state.

### Phase 10: End-To-End Validation And Hardening

Validate the full path before treating the feature as shipped.

- Add backend tests for lifecycle, restore, removal, and session ownership.
- Add frontend tests for typed commands, store actions, office HUD, floor view model, and pet behavior.
- Add browser smoke coverage for:
  - create companion
  - pet appears and follows parent
  - companion terminal opens
  - companion waiting/blocked state is visible
  - parent selection does not open a pet panel
- Run `npm run check`.
- Run `npm run test:e2e:run` if the browser smoke tests were added in the same phase.
- Update `README.md`, `docs/architecture.md`, and `docs/activity-contract.md` only when behavior is implemented, not while it is still proposed.

Definition of done:

- The system is documented as current behavior.
- Validation covers backend state, UI plumbing, and floor movement.
- The companion feature does not weaken the existing backend-state-as-source-of-truth rule.

## Non-Goals For V1

- Forking an active PTY session.
- Sharing one terminal session between parent and companion.
- Starting shell, Codex, managed processes, or a default prompt during companion creation.
- Nested companions.
- Automatic worktree creation.
- Automatic secret decryption without explicit user control.
- Frontend parsing of terminal output for companion state.

## Open Decisions

- Should `robot` use the same organic follow animation timing as `dog`/`cat`, or a more mechanical timing curve?
- Should pet names default to variant names, numbered names, or names derived from the parent employee?
- Should multiple pets arrange in a fixed order by creation time or dynamically choose the least crowded follow slot?
