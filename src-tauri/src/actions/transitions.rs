use super::{
    Action, ActionStatus, DEFAULT_ACTION_TIMEOUT_SECS, MAX_ACTION_TIMEOUT_SECS,
    MAX_FILE_WRITE_CONTENT_BYTES,
};

pub(super) fn validate_transition(from: ActionStatus, to: ActionStatus) -> Result<(), String> {
    let allowed = matches!(
        (from, to),
        (ActionStatus::Draft, ActionStatus::PendingApproval)
            | (ActionStatus::PendingApproval, ActionStatus::Approved)
            | (ActionStatus::PendingApproval, ActionStatus::Rejected)
            | (ActionStatus::Approved, ActionStatus::Running)
            | (ActionStatus::Approved, ActionStatus::Cancelled)
            | (ActionStatus::Running, ActionStatus::Succeeded)
            | (ActionStatus::Running, ActionStatus::Failed)
            | (ActionStatus::Running, ActionStatus::Cancelled)
            | (ActionStatus::Draft, ActionStatus::Cancelled)
            | (ActionStatus::PendingApproval, ActionStatus::Cancelled)
    );

    if allowed {
        Ok(())
    } else {
        Err(format!(
            "invalid action transition from {} to {}",
            action_status_label(from),
            action_status_label(to)
        ))
    }
}

pub(super) fn ensure_action_approval(action: &Action, approval_id: &str) -> Result<(), String> {
    if action.approval_id.as_deref() == Some(approval_id) {
        Ok(())
    } else {
        Err("approval is not linked to this action".to_string())
    }
}

pub(super) fn normalize_timeout_secs(timeout_secs: Option<u64>) -> Result<u64, String> {
    match timeout_secs {
        Some(0) => Err("timeoutSecs must be greater than zero".to_string()),
        Some(timeout) if timeout > MAX_ACTION_TIMEOUT_SECS => {
            Err(format!("timeoutSecs must be <= {MAX_ACTION_TIMEOUT_SECS}"))
        }
        Some(timeout) => Ok(timeout),
        None => Ok(DEFAULT_ACTION_TIMEOUT_SECS),
    }
}

pub(super) fn ensure_file_write_size(contents: &str) -> Result<(), String> {
    if contents.len() > MAX_FILE_WRITE_CONTENT_BYTES {
        Err(format!(
            "file-write action contents exceed {} bytes",
            MAX_FILE_WRITE_CONTENT_BYTES
        ))
    } else {
        Ok(())
    }
}

pub(super) fn action_status_label(status: ActionStatus) -> &'static str {
    match status {
        ActionStatus::Draft => "draft",
        ActionStatus::PendingApproval => "pending_approval",
        ActionStatus::Approved => "approved",
        ActionStatus::Running => "running",
        ActionStatus::Succeeded => "succeeded",
        ActionStatus::Failed => "failed",
        ActionStatus::Rejected => "rejected",
        ActionStatus::Cancelled => "cancelled",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transition_validation_accepts_expected_paths() {
        assert!(validate_transition(ActionStatus::Draft, ActionStatus::PendingApproval).is_ok());
        assert!(validate_transition(ActionStatus::PendingApproval, ActionStatus::Approved).is_ok());
        assert!(validate_transition(ActionStatus::Approved, ActionStatus::Running).is_ok());
        assert!(validate_transition(ActionStatus::Running, ActionStatus::Succeeded).is_ok());
        assert!(validate_transition(ActionStatus::Running, ActionStatus::Failed).is_ok());
        assert!(validate_transition(ActionStatus::Running, ActionStatus::Cancelled).is_ok());
    }

    #[test]
    fn transition_validation_rejects_invalid_paths() {
        assert!(validate_transition(ActionStatus::Draft, ActionStatus::Running).is_err());
        assert!(validate_transition(ActionStatus::Approved, ActionStatus::Rejected).is_err());
        assert!(validate_transition(ActionStatus::Succeeded, ActionStatus::Cancelled).is_err());
    }

    #[test]
    fn file_write_content_limit_is_enforced() {
        let contents = "x".repeat(MAX_FILE_WRITE_CONTENT_BYTES + 1);

        assert!(ensure_file_write_size(&contents).is_err());
    }

    #[test]
    fn timeout_limit_is_enforced() {
        assert_eq!(
            normalize_timeout_secs(None).unwrap(),
            DEFAULT_ACTION_TIMEOUT_SECS
        );
        assert!(normalize_timeout_secs(Some(0)).is_err());
        assert!(normalize_timeout_secs(Some(MAX_ACTION_TIMEOUT_SECS + 1)).is_err());
    }
}
