use super::{
    AgentRuntimeConfidence, AgentRuntimeSnapshot, AgentRuntimeSource, AgentRuntimeState,
    AgentRuntimeStore, TerminalLaunchProfile, TerminalSessionStatus, TerminalSessionStore,
    TerminalTurnState,
};

const SESSION_ID: &str = "fixture-session";
const EMPLOYEE_ID: &str = "fixture-employee";
const FIXTURE_CWD: &str = "fixture-workspace";

#[derive(Debug)]
struct Fixture {
    name: &'static str,
    launch_profile: TerminalLaunchProfile,
    events: Vec<FixtureEvent>,
    expected: ExpectedState,
}

#[derive(Debug)]
enum FixtureEvent {
    Output(&'static str),
    Input(&'static str),
    ActiveProfile(TerminalLaunchProfile),
    Finish(i32),
}

#[derive(Debug)]
struct ExpectedState {
    status: TerminalSessionStatus,
    profile: TerminalLaunchProfile,
    active_profile: TerminalLaunchProfile,
    turn_state: TerminalTurnState,
    has_prompt_submitted_at: bool,
    has_prompt_ready_at: bool,
    has_approval_prompt_at: bool,
    runtime_state: AgentRuntimeState,
    runtime_source: AgentRuntimeSource,
    runtime_confidence: AgentRuntimeConfidence,
}

#[test]
fn pty_terminal_evidence_fixture_corpus_matches_current_parser_behavior() {
    for fixture in fixtures() {
        let (session, runtime) = replay_fixture(&fixture);
        assert_eq!(
            session.status, fixture.expected.status,
            "{}: status",
            fixture.name
        );
        assert_eq!(
            session.profile, fixture.expected.profile,
            "{}: launch profile",
            fixture.name
        );
        assert_eq!(
            session.active_profile,
            Some(fixture.expected.active_profile),
            "{}: active profile",
            fixture.name
        );
        assert_eq!(
            session.turn_state, fixture.expected.turn_state,
            "{}: turn state",
            fixture.name
        );
        assert_eq!(
            session.last_prompt_submitted_at.is_some(),
            fixture.expected.has_prompt_submitted_at,
            "{}: prompt submitted timestamp",
            fixture.name
        );
        assert_eq!(
            session.last_prompt_ready_at.is_some(),
            fixture.expected.has_prompt_ready_at,
            "{}: prompt ready timestamp",
            fixture.name
        );
        assert_eq!(
            session.last_approval_prompt_at.is_some(),
            fixture.expected.has_approval_prompt_at,
            "{}: approval prompt timestamp",
            fixture.name
        );
        assert_eq!(
            runtime.state, fixture.expected.runtime_state,
            "{}: runtime state",
            fixture.name
        );
        assert_eq!(
            runtime.source, fixture.expected.runtime_source,
            "{}: runtime source",
            fixture.name
        );
        assert_eq!(
            runtime.confidence, fixture.expected.runtime_confidence,
            "{}: runtime confidence",
            fixture.name
        );
    }
}

fn replay_fixture(fixture: &Fixture) -> (super::TerminalSessionRecord, AgentRuntimeSnapshot) {
    let store = TerminalSessionStore::default();
    let runtime = AgentRuntimeStore::default();
    let created = store.create(
        SESSION_ID.to_string(),
        EMPLOYEE_ID.to_string(),
        fixture.launch_profile,
        FIXTURE_CWD.to_string(),
    );
    runtime.sync_from_terminal_session(&created);

    for event in &fixture.events {
        match event {
            FixtureEvent::Output(output) => {
                if let Some(record) = store.record_output(SESSION_ID, output) {
                    runtime.sync_from_terminal_session(&record);
                }
            }
            FixtureEvent::Input(input) => {
                if let Some(record) = store.record_input(SESSION_ID, input) {
                    runtime.sync_from_terminal_session(&record);
                }
            }
            FixtureEvent::ActiveProfile(active_profile) => {
                if let Some(record) = store.set_active_profile(SESSION_ID, *active_profile) {
                    runtime.sync_from_terminal_session(&record);
                }
            }
            FixtureEvent::Finish(exit_code) => {
                if let Some(record) = store.finish(SESSION_ID, *exit_code) {
                    runtime.sync_from_terminal_session(&record);
                }
            }
        }
    }

    let session = store
        .get(SESSION_ID)
        .expect("fixture session should exist after replay");
    let snapshot = runtime
        .snapshot(SESSION_ID)
        .unwrap_or_else(AgentRuntimeSnapshot::none);
    (session, snapshot)
}

fn fixtures() -> Vec<Fixture> {
    vec![
        Fixture {
            name: "shell open stays shell",
            launch_profile: TerminalLaunchProfile::Shell,
            events: vec![],
            expected: expected_shell(TerminalSessionStatus::Running, TerminalTurnState::Shell),
        },
        Fixture {
            name: "direct Codex launch starts as codex_starting",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![],
            expected: expected_codex(
                TerminalSessionStatus::Running,
                TerminalTurnState::CodexStarting,
                false,
                false,
                false,
                AgentRuntimeState::Starting,
            ),
        },
        Fixture {
            name: "Codex prompt ready moves to owner prompt ready",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![FixtureEvent::Output("\r\n› ")],
            expected: expected_codex_waiting_prompt(false),
        },
        Fixture {
            name: "owner typing without Enter becomes owner composing",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("write fixture docs"),
            ],
            expected: expected_codex(
                TerminalSessionStatus::Running,
                TerminalTurnState::OwnerComposing,
                false,
                true,
                false,
                AgentRuntimeState::WaitingPrompt,
            ),
        },
        Fixture {
            name: "prompt submission becomes prompt submitted",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("write fixture docs\r"),
            ],
            expected: expected_codex(
                TerminalSessionStatus::Running,
                TerminalTurnState::PromptSubmitted,
                true,
                false,
                false,
                AgentRuntimeState::Thinking,
            ),
        },
        Fixture {
            name: "working output becomes agent working",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("\r\n• Working (1s • esc to interrupt)"),
            ],
            expected: expected_codex(
                TerminalSessionStatus::Running,
                TerminalTurnState::AgentWorking,
                true,
                false,
                false,
                AgentRuntimeState::Thinking,
            ),
        },
        Fixture {
            name: "prompt echo followed by Working remains agent working",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output(
                    "\r\n› write fixture docs\r\n\r\n• Working (2s • esc to interrupt)",
                ),
            ],
            expected: expected_codex(
                TerminalSessionStatus::Running,
                TerminalTurnState::AgentWorking,
                true,
                false,
                false,
                AgentRuntimeState::Thinking,
            ),
        },
        Fixture {
            name: "final answer followed by returned prompt becomes owner prompt ready",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("\r\n• Working (2s • esc to interrupt)"),
                FixtureEvent::Output("\r\nDone.\r\n› "),
            ],
            expected: expected_codex_waiting_prompt(true),
        },
        Fixture {
            name: "stale Working redraw plus returned prompt becomes owner prompt ready",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("\r\n• Working (2s • esc to interrupt)"),
                FixtureEvent::Output("\x1b[2K\r• Working (2s • esc to interrupt)\r\nDone.\r\n› "),
            ],
            expected: expected_codex_waiting_prompt(true),
        },
        Fixture {
            name: "approval prompt becomes waiting approval",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("Allow command to run?\n› Yes / No"),
            ],
            expected: expected_codex_waiting_approval(true),
        },
        Fixture {
            name: "approval response submission returns to prompt submitted",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("Allow command to run?\n› Yes / No"),
                FixtureEvent::Input("y\r"),
            ],
            expected: expected_codex(
                TerminalSessionStatus::Running,
                TerminalTurnState::PromptSubmitted,
                true,
                false,
                false,
                AgentRuntimeState::Thinking,
            ),
        },
        Fixture {
            name: "approval prompt split across chunks is detected",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("Allow "),
                FixtureEvent::Output("command to run?\n› Yes / No"),
            ],
            expected: expected_codex_waiting_approval(true),
        },
        Fixture {
            name: "prompt-ready output split across chunks is detected",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![FixtureEvent::Output("\r\n"), FixtureEvent::Output("› ")],
            expected: expected_codex_waiting_prompt(false),
        },
        Fixture {
            name: "shell-launched Codex prompt ready switches active profile",
            launch_profile: TerminalLaunchProfile::Shell,
            events: vec![FixtureEvent::Output("\r\n› ")],
            expected: expected_shell_codex(
                TerminalTurnState::OwnerPromptReady,
                false,
                true,
                false,
                AgentRuntimeState::WaitingPrompt,
            ),
        },
        Fixture {
            name: "shell-launched Codex working output routes to agent working",
            launch_profile: TerminalLaunchProfile::Shell,
            events: vec![
                FixtureEvent::ActiveProfile(TerminalLaunchProfile::Codex),
                FixtureEvent::Output("\r\n• Working (1s • esc to interrupt)"),
            ],
            expected: expected_shell_codex(
                TerminalTurnState::AgentWorking,
                false,
                false,
                false,
                AgentRuntimeState::Thinking,
            ),
        },
        Fixture {
            name: "active-profile shell reset clears stale Codex prompt state",
            launch_profile: TerminalLaunchProfile::Shell,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("Allow command to run?\n› Yes / No"),
                FixtureEvent::ActiveProfile(TerminalLaunchProfile::Shell),
            ],
            expected: expected_shell(TerminalSessionStatus::Running, TerminalTurnState::Shell),
        },
        Fixture {
            name: "exited Codex session maps to completed runtime with unchanged turn state",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![FixtureEvent::Finish(0)],
            expected: expected_codex(
                TerminalSessionStatus::Exited,
                TerminalTurnState::CodexStarting,
                false,
                false,
                false,
                AgentRuntimeState::Completed,
            ),
        },
        Fixture {
            name: "failed Codex session maps to failed runtime with unchanged turn state",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![FixtureEvent::Finish(1)],
            expected: expected_codex(
                TerminalSessionStatus::Failed,
                TerminalTurnState::CodexStarting,
                false,
                false,
                false,
                AgentRuntimeState::Failed,
            ),
        },
    ]
}

fn expected_shell(status: TerminalSessionStatus, turn_state: TerminalTurnState) -> ExpectedState {
    ExpectedState {
        status,
        profile: TerminalLaunchProfile::Shell,
        active_profile: TerminalLaunchProfile::Shell,
        turn_state,
        has_prompt_submitted_at: false,
        has_prompt_ready_at: false,
        has_approval_prompt_at: false,
        runtime_state: AgentRuntimeState::NotActive,
        runtime_source: AgentRuntimeSource::None,
        runtime_confidence: AgentRuntimeConfidence::None,
    }
}

fn expected_codex_waiting_prompt(has_prompt_submitted_at: bool) -> ExpectedState {
    expected_codex(
        TerminalSessionStatus::Running,
        TerminalTurnState::OwnerPromptReady,
        has_prompt_submitted_at,
        true,
        false,
        AgentRuntimeState::WaitingPrompt,
    )
}

fn expected_codex_waiting_approval(has_prompt_submitted_at: bool) -> ExpectedState {
    expected_codex(
        TerminalSessionStatus::Running,
        TerminalTurnState::WaitingApproval,
        has_prompt_submitted_at,
        false,
        true,
        AgentRuntimeState::WaitingApproval,
    )
}

fn expected_codex(
    status: TerminalSessionStatus,
    turn_state: TerminalTurnState,
    has_prompt_submitted_at: bool,
    has_prompt_ready_at: bool,
    has_approval_prompt_at: bool,
    runtime_state: AgentRuntimeState,
) -> ExpectedState {
    ExpectedState {
        status,
        profile: TerminalLaunchProfile::Codex,
        active_profile: TerminalLaunchProfile::Codex,
        turn_state,
        has_prompt_submitted_at,
        has_prompt_ready_at,
        has_approval_prompt_at,
        runtime_state,
        runtime_source: AgentRuntimeSource::TerminalFallback,
        runtime_confidence: AgentRuntimeConfidence::TerminalFallback,
    }
}

fn expected_shell_codex(
    turn_state: TerminalTurnState,
    has_prompt_submitted_at: bool,
    has_prompt_ready_at: bool,
    has_approval_prompt_at: bool,
    runtime_state: AgentRuntimeState,
) -> ExpectedState {
    ExpectedState {
        status: TerminalSessionStatus::Running,
        profile: TerminalLaunchProfile::Shell,
        active_profile: TerminalLaunchProfile::Codex,
        turn_state,
        has_prompt_submitted_at,
        has_prompt_ready_at,
        has_approval_prompt_at,
        runtime_state,
        runtime_source: AgentRuntimeSource::TerminalFallback,
        runtime_confidence: AgentRuntimeConfidence::TerminalFallback,
    }
}
