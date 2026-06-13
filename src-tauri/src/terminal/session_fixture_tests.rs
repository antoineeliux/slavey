use std::collections::BTreeSet;

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
    NotifyTurnComplete,
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
        assert_fixture_result(&fixture, &session, &runtime, "canonical replay");
    }
}

#[test]
fn pty_terminal_fixture_outputs_are_chunk_boundary_invariant() {
    for fixture in fixtures() {
        for (event_index, output) in fixture_output_events(&fixture) {
            for split_at in representative_split_points(output) {
                let context = format!(
                    "split output event {event_index} at byte {split_at} in {:?}",
                    output
                );
                let (session, runtime) =
                    replay_fixture_with_output_split(&fixture, event_index, split_at);
                assert_fixture_result(&fixture, &session, &runtime, &context);
            }
        }
    }
}

#[test]
fn pty_terminal_key_flows_tolerate_single_character_streaming() {
    let fixture_names = [
        "Codex prompt ready moves to owner prompt ready",
        "prompt echo followed by Working remains agent working",
        "final answer followed by returned prompt becomes owner prompt ready",
        "stale Working redraw plus returned prompt becomes owner prompt ready",
        "approval prompt split across chunks is detected",
        "shell-launched Codex working output routes to agent working",
        "notify turn complete resolves fast turn without working line",
        "stale working redraw after notify turn complete stays owner prompt ready",
    ];
    let fixtures = fixtures();

    for fixture_name in fixture_names {
        let fixture = fixtures
            .iter()
            .find(|fixture| fixture.name == fixture_name)
            .expect("single-character streaming fixture should exist");
        let (session, runtime) = replay_fixture_with_char_streamed_outputs(fixture);
        assert_fixture_result(
            fixture,
            &session,
            &runtime,
            "single-character output streaming",
        );
    }
}

#[test]
fn pty_terminal_redraw_control_sequence_boundaries_preserve_prompt_ready() {
    let fixtures = fixtures();
    let fixture = fixtures
        .iter()
        .find(|fixture| {
            fixture.name == "stale Working redraw plus returned prompt becomes owner prompt ready"
        })
        .expect("redraw fixture should exist");
    let (event_index, output) = fixture_output_events(fixture)
        .into_iter()
        .find(|(_, output)| output.contains("\x1b[2K\r"))
        .expect("redraw fixture should include a clear-line carriage-return sequence");

    for split_at in control_sequence_split_points(output) {
        let context = format!("redraw/control split output event {event_index} at byte {split_at}");
        let (session, runtime) = replay_fixture_with_output_split(fixture, event_index, split_at);
        assert_fixture_result(fixture, &session, &runtime, &context);
    }
}

fn replay_fixture(fixture: &Fixture) -> (super::TerminalSessionRecord, AgentRuntimeSnapshot) {
    replay_fixture_with_output_chunks(fixture, |_, output| vec![output.to_string()])
}

fn replay_fixture_with_output_split(
    fixture: &Fixture,
    split_event_index: usize,
    split_at: usize,
) -> (super::TerminalSessionRecord, AgentRuntimeSnapshot) {
    replay_fixture_with_output_chunks(fixture, |event_index, output| {
        if event_index == split_event_index {
            split_output_at(output, split_at)
        } else {
            vec![output.to_string()]
        }
    })
}

fn replay_fixture_with_char_streamed_outputs(
    fixture: &Fixture,
) -> (super::TerminalSessionRecord, AgentRuntimeSnapshot) {
    replay_fixture_with_output_chunks(fixture, |_, output| {
        output
            .chars()
            .map(|character| character.to_string())
            .collect()
    })
}

fn replay_fixture_with_output_chunks(
    fixture: &Fixture,
    output_chunks: impl Fn(usize, &str) -> Vec<String>,
) -> (super::TerminalSessionRecord, AgentRuntimeSnapshot) {
    let store = TerminalSessionStore::default();
    let runtime = AgentRuntimeStore::default();
    let created = store.create(
        SESSION_ID.to_string(),
        EMPLOYEE_ID.to_string(),
        fixture.launch_profile,
        FIXTURE_CWD.to_string(),
    );
    runtime.sync_from_terminal_session(&created);

    for (event_index, event) in fixture.events.iter().enumerate() {
        match event {
            FixtureEvent::Output(output) => {
                for chunk in output_chunks(event_index, output) {
                    if chunk.is_empty() {
                        continue;
                    }
                    if let Some(record) = store.record_output(SESSION_ID, &chunk) {
                        runtime.sync_from_terminal_session(&record);
                    }
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
            FixtureEvent::NotifyTurnComplete => {
                if let Some(record) = store
                    .record_codex_notify_agent_turn_complete(SESSION_ID, crate::events::now_ms())
                {
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

fn assert_fixture_result(
    fixture: &Fixture,
    session: &super::TerminalSessionRecord,
    runtime: &AgentRuntimeSnapshot,
    context: &str,
) {
    assert_eq!(
        session.status, fixture.expected.status,
        "{}: {context}: status",
        fixture.name
    );
    assert_eq!(
        session.profile, fixture.expected.profile,
        "{}: {context}: launch profile",
        fixture.name
    );
    assert_eq!(
        session.active_profile,
        Some(fixture.expected.active_profile),
        "{}: {context}: active profile",
        fixture.name
    );
    assert_eq!(
        session.turn_state, fixture.expected.turn_state,
        "{}: {context}: turn state",
        fixture.name
    );
    assert_eq!(
        session.last_prompt_submitted_at.is_some(),
        fixture.expected.has_prompt_submitted_at,
        "{}: {context}: prompt submitted timestamp",
        fixture.name
    );
    assert_eq!(
        session.last_prompt_ready_at.is_some(),
        fixture.expected.has_prompt_ready_at,
        "{}: {context}: prompt ready timestamp",
        fixture.name
    );
    assert_eq!(
        session.last_approval_prompt_at.is_some(),
        fixture.expected.has_approval_prompt_at,
        "{}: {context}: approval prompt timestamp",
        fixture.name
    );
    assert_eq!(
        runtime.state, fixture.expected.runtime_state,
        "{}: {context}: runtime state",
        fixture.name
    );
    assert_eq!(
        runtime.source, fixture.expected.runtime_source,
        "{}: {context}: runtime source",
        fixture.name
    );
    assert_eq!(
        runtime.confidence, fixture.expected.runtime_confidence,
        "{}: {context}: runtime confidence",
        fixture.name
    );
}

fn fixture_output_events(fixture: &Fixture) -> Vec<(usize, &'static str)> {
    fixture
        .events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| match event {
            FixtureEvent::Output(output) => Some((index, *output)),
            FixtureEvent::Input(_)
            | FixtureEvent::ActiveProfile(_)
            | FixtureEvent::NotifyTurnComplete
            | FixtureEvent::Finish(_) => None,
        })
        .collect()
}

fn split_output_at(output: &str, split_at: usize) -> Vec<String> {
    assert!(
        output.is_char_boundary(split_at),
        "split index should be on a char boundary"
    );
    let (left, right) = output.split_at(split_at);
    vec![left.to_string(), right.to_string()]
}

fn representative_split_points(output: &str) -> Vec<usize> {
    let char_boundaries = char_boundaries(output);
    if output.chars().count() <= 32 {
        return char_boundaries;
    }

    let mut split_points = BTreeSet::new();
    insert_if_boundary(output, 0, &mut split_points);
    insert_if_boundary(output, output.len(), &mut split_points);
    if let Some(index) = byte_index_after_chars(output, 1) {
        insert_if_boundary(output, index, &mut split_points);
    }
    if let Some(index) = byte_index_after_chars(output, output.chars().count() / 2) {
        insert_if_boundary(output, index, &mut split_points);
    }
    if let Some(index) = byte_index_after_chars(output, output.chars().count().saturating_sub(1)) {
        insert_if_boundary(output, index, &mut split_points);
    }
    insert_marker_boundaries(output, "\x1b[2K", &mut split_points);
    insert_marker_boundaries(output, "\x1b[2K\r", &mut split_points);
    insert_marker_boundaries(output, "\r", &mut split_points);
    insert_marker_boundaries(output, "›", &mut split_points);
    insert_marker_boundaries(output, "Working", &mut split_points);
    insert_marker_boundaries(output, "Allow", &mut split_points);
    insert_marker_boundaries(output, "Yes", &mut split_points);
    insert_marker_boundaries(output, "No", &mut split_points);
    insert_marker_boundaries(output, "Yes / No", &mut split_points);

    split_points.into_iter().collect()
}

fn control_sequence_split_points(output: &str) -> Vec<usize> {
    let mut split_points = BTreeSet::new();
    insert_marker_boundaries(output, "\x1b[2K", &mut split_points);
    insert_marker_boundaries(output, "\x1b[2K\r", &mut split_points);
    insert_marker_boundaries(output, "\r", &mut split_points);
    insert_marker_boundaries(output, "›", &mut split_points);
    split_points.into_iter().collect()
}

fn char_boundaries(output: &str) -> Vec<usize> {
    let mut boundaries = output
        .char_indices()
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    boundaries.push(output.len());
    boundaries.sort_unstable();
    boundaries.dedup();
    boundaries
}

fn byte_index_after_chars(output: &str, char_count: usize) -> Option<usize> {
    if char_count == 0 {
        return Some(0);
    }
    output
        .char_indices()
        .nth(char_count)
        .map(|(index, _)| index)
        .or_else(|| (char_count == output.chars().count()).then_some(output.len()))
}

fn insert_marker_boundaries(output: &str, marker: &str, split_points: &mut BTreeSet<usize>) {
    for (index, _) in output.match_indices(marker) {
        insert_if_boundary(output, index, split_points);
        insert_if_boundary(output, index + marker.len(), split_points);
    }
}

fn insert_if_boundary(output: &str, index: usize, split_points: &mut BTreeSet<usize>) {
    if index <= output.len() && output.is_char_boundary(index) {
        split_points.insert(index);
    }
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
            name: "duplicate Working redraw plus returned prompt stays owner prompt ready",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("\r\n• Working (2s • esc to interrupt)"),
                FixtureEvent::Output("\x1b[2K\r• Working (2s • esc to interrupt)"),
                FixtureEvent::Output("\x1b[2K\r• Working (2s • esc to interrupt)"),
                FixtureEvent::Output("\x1b[2K\r• Working (2s • esc to interrupt)\r\nDone.\r\n› "),
            ],
            expected: expected_codex_waiting_prompt(true),
        },
        Fixture {
            name: "notify turn complete resolves fast turn without working line",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("hello\r"),
                FixtureEvent::Output(
                    "\r\n› hello\r\n\r\nHello! How can I help you today?\r\n\r\n› ",
                ),
                FixtureEvent::NotifyTurnComplete,
            ],
            expected: expected_codex_waiting_prompt(true),
        },
        Fixture {
            name: "notify turn complete resolves long final answer beyond detection tail",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("\r\n• Working (2s • esc to interrupt)"),
                FixtureEvent::Output(long_final_answer_output()),
                FixtureEvent::NotifyTurnComplete,
            ],
            expected: expected_codex_waiting_prompt(true),
        },
        Fixture {
            name: "stale working redraw after notify turn complete stays owner prompt ready",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("\r\n• Working (2s • esc to interrupt)"),
                FixtureEvent::NotifyTurnComplete,
                FixtureEvent::Output("\x1b[2K\r• Working (3s • esc to interrupt)"),
            ],
            expected: expected_codex_waiting_prompt(true),
        },
        // Approval fixtures use shell-launched Codex: direct Codex sessions run
        // with approvals bypassed, so terminal approval prompts cannot occur there.
        Fixture {
            name: "approval prompt becomes waiting approval",
            launch_profile: TerminalLaunchProfile::Shell,
            events: vec![
                FixtureEvent::ActiveProfile(TerminalLaunchProfile::Codex),
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("Allow command to run?\n› Yes / No"),
            ],
            expected: expected_shell_codex(
                TerminalTurnState::WaitingApproval,
                true,
                false,
                true,
                AgentRuntimeState::WaitingApproval,
            ),
        },
        Fixture {
            name: "approval response submission returns to prompt submitted",
            launch_profile: TerminalLaunchProfile::Shell,
            events: vec![
                FixtureEvent::ActiveProfile(TerminalLaunchProfile::Codex),
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("Allow command to run?\n› Yes / No"),
                FixtureEvent::Input("y\r"),
            ],
            expected: expected_shell_codex(
                TerminalTurnState::PromptSubmitted,
                true,
                false,
                false,
                AgentRuntimeState::Thinking,
            ),
        },
        Fixture {
            name: "approval prompt split across chunks is detected",
            launch_profile: TerminalLaunchProfile::Shell,
            events: vec![
                FixtureEvent::ActiveProfile(TerminalLaunchProfile::Codex),
                FixtureEvent::Input("write fixture docs\r"),
                FixtureEvent::Output("Allow "),
                FixtureEvent::Output("command to run?\n› Yes / No"),
            ],
            expected: expected_shell_codex(
                TerminalTurnState::WaitingApproval,
                true,
                false,
                true,
                AgentRuntimeState::WaitingApproval,
            ),
        },
        Fixture {
            name: "direct Codex answer mentioning permissions stays owner prompt ready",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![
                FixtureEvent::Output("\r\n› "),
                FixtureEvent::Input("update the docs\r"),
                FixtureEvent::Output("\r\n• Working (2s • esc to interrupt)"),
                FixtureEvent::Output(
                    "\r\nYes, you can now run the tests; permission checks were added.\r\n› ",
                ),
            ],
            expected: expected_codex_waiting_prompt(true),
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
            name: "exited Codex session maps to completed turn state and runtime",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![FixtureEvent::Finish(0)],
            expected: expected_codex(
                TerminalSessionStatus::Exited,
                TerminalTurnState::Completed,
                false,
                false,
                false,
                AgentRuntimeState::Completed,
            ),
        },
        Fixture {
            name: "failed Codex session maps to failed turn state and runtime",
            launch_profile: TerminalLaunchProfile::Codex,
            events: vec![FixtureEvent::Finish(1)],
            expected: expected_codex(
                TerminalSessionStatus::Failed,
                TerminalTurnState::Failed,
                false,
                false,
                false,
                AgentRuntimeState::Failed,
            ),
        },
    ]
}

fn long_final_answer_output() -> &'static str {
    static OUTPUT: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    OUTPUT.get_or_init(|| {
        format!(
            "\r\n{}\r\n› ",
            "All checks passed and the requested fixture docs were written. ".repeat(24)
        )
    })
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
