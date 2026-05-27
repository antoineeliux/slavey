use super::{
    now_ms, Action, ActionFailureReason, ActionKind, ActionStatus, MAX_ACTION_OUTPUT_BYTES,
    MAX_PERSISTED_ACTIONS,
};

pub fn restore_actions(actions: &[Action]) -> Vec<Action> {
    prune_action_history_for_persistence(
        actions
            .iter()
            .cloned()
            .map(|mut action| {
                if action.status == ActionStatus::Running {
                    action.status = ActionStatus::Failed;
                    action.error = Some("app restarted before action completed".to_string());
                    action.output = "app restarted before action completed".to_string();
                    action.failure_reason = Some(ActionFailureReason::AppRestarted);
                    action.finished_at = Some(now_ms());
                    action.updated_at = now_ms();
                }
                if action.kind == ActionKind::FileWrite
                    && action.contents.is_none()
                    && !is_terminal_action_status(action.status)
                {
                    action.status = ActionStatus::Failed;
                    action.error = Some(
                        "file write contents are not persisted; recreate the action".to_string(),
                    );
                    action.failure_reason = Some(ActionFailureReason::ValidationFailed);
                    action.finished_at = Some(now_ms());
                    action.updated_at = now_ms();
                }
                action.output = truncate_action_output(&action.output);
                if action.output_cap_bytes == 0 {
                    action.output_cap_bytes = MAX_ACTION_OUTPUT_BYTES;
                }
                if matches!(action.status, ActionStatus::Cancelled)
                    && action.cancellation_reason.is_none()
                {
                    action.cancellation_reason = Some(
                        action
                            .error
                            .clone()
                            .unwrap_or_else(|| "action cancelled".to_string()),
                    );
                }
                action
            })
            .collect(),
    )
}

pub fn prune_action_history_for_persistence(actions: Vec<Action>) -> Vec<Action> {
    let mut normalized = actions
        .into_iter()
        .map(action_for_persistence)
        .collect::<Vec<_>>();
    let mut terminal = normalized
        .iter()
        .filter(|action| is_terminal_action_status(action.status))
        .map(|action| action.id.clone())
        .collect::<Vec<_>>();

    if terminal.len() <= MAX_PERSISTED_ACTIONS {
        normalized.sort_by_key(|action| action.created_at);
        return normalized;
    }

    terminal.sort_by_key(|id| {
        std::cmp::Reverse(
            normalized
                .iter()
                .find(|action| action.id == *id)
                .map(|action| action.updated_at.max(action.created_at))
                .unwrap_or_default(),
        )
    });
    let keep_terminal = terminal
        .into_iter()
        .take(MAX_PERSISTED_ACTIONS)
        .collect::<std::collections::HashSet<_>>();
    normalized.retain(|action| {
        !is_terminal_action_status(action.status) || keep_terminal.contains(&action.id)
    });
    normalized.sort_by_key(|action| action.created_at);
    normalized
}

pub fn action_for_persistence(mut action: Action) -> Action {
    action.contents = None;
    action.output = truncate_action_output(&action.output);
    if action.output_cap_bytes == 0 {
        action.output_cap_bytes = MAX_ACTION_OUTPUT_BYTES;
    }
    action
}

pub fn is_terminal_action_status(status: ActionStatus) -> bool {
    matches!(
        status,
        ActionStatus::Succeeded
            | ActionStatus::Failed
            | ActionStatus::Rejected
            | ActionStatus::Cancelled
    )
}

pub(super) fn truncate_action_output(output: &str) -> String {
    if output.len() <= MAX_ACTION_OUTPUT_BYTES {
        return output.to_string();
    }
    let mut end = MAX_ACTION_OUTPUT_BYTES;
    while !output.is_char_boundary(end) {
        end -= 1;
    }
    output[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::super::{ActionSource, DEFAULT_ACTION_TIMEOUT_SECS};
    use super::*;

    #[test]
    fn persisted_action_history_is_capped_and_redacts_contents() {
        let actions = (0..(MAX_PERSISTED_ACTIONS + 5))
            .map(|index| shell_action_for_history(index as u64))
            .collect::<Vec<_>>();

        let pruned = prune_action_history_for_persistence(actions);

        assert_eq!(pruned.len(), MAX_PERSISTED_ACTIONS);
        assert!(pruned.iter().all(|action| action.contents.is_none()));
        assert!(!pruned.iter().any(|action| action.id == "action-0"));
        assert!(pruned.iter().any(|action| action.id == "action-254"));
    }

    fn shell_action_for_history(index: u64) -> Action {
        Action {
            id: format!("action-{index}"),
            employee_id: "employee-1".to_string(),
            kind: ActionKind::ShellCommand,
            title: "History".to_string(),
            description: "History".to_string(),
            cwd: None,
            command: Some("pwd".to_string()),
            path: None,
            contents: Some("redacted".to_string()),
            source: ActionSource::User,
            timeout_secs: DEFAULT_ACTION_TIMEOUT_SECS,
            output_cap_bytes: MAX_ACTION_OUTPUT_BYTES,
            approval_id: None,
            status: ActionStatus::Succeeded,
            output: String::new(),
            error: None,
            failure_reason: None,
            cancellation_reason: None,
            created_at: index,
            updated_at: index,
            started_at: Some(index),
            finished_at: Some(index),
        }
    }
}
