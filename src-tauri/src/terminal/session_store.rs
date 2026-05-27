use std::{collections::HashMap, sync::Arc};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::{TerminalLaunchProfile, TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE, TERMINAL_LABEL_MAX_CHARS};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalSessionStatus {
    Running,
    Exited,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalStopReason {
    UserStopped,
    Exited,
    FailedToStart,
    AppRestarted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionRecord {
    pub session_id: String,
    pub employee_id: String,
    pub profile: TerminalLaunchProfile,
    pub cwd: String,
    pub status: TerminalSessionStatus,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    #[serde(default)]
    pub stopped_at: Option<u64>,
    #[serde(default)]
    pub stop_reason: Option<TerminalStopReason>,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub last_output_at: Option<u64>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Clone, Default)]
pub struct TerminalSessionStore {
    records: Arc<Mutex<HashMap<String, TerminalSessionRecord>>>,
}

impl TerminalSessionStore {
    pub fn create(
        &self,
        session_id: String,
        employee_id: String,
        profile: TerminalLaunchProfile,
        cwd: String,
    ) -> TerminalSessionRecord {
        let now = crate::events::now_ms();
        let record = TerminalSessionRecord {
            session_id,
            employee_id,
            profile,
            cwd,
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: now,
            ended_at: None,
            stopped_at: None,
            stop_reason: None,
            label: format!("{} session", profile.display_label()),
            last_output_at: None,
            message: None,
        };
        let mut records = self.records.lock();
        records.insert(record.session_id.clone(), record.clone());
        prune_employee_history(&mut records, &record.employee_id);
        record
    }

    pub fn list(&self, employee_id: Option<&str>) -> Vec<TerminalSessionRecord> {
        let mut records = self
            .records
            .lock()
            .values()
            .filter(|record| {
                employee_id
                    .map(|employee_id| record.employee_id == employee_id)
                    .unwrap_or(true)
            })
            .cloned()
            .collect::<Vec<_>>();
        records.sort_by_key(|record| record.started_at);
        records
    }

    pub fn get(&self, session_id: &str) -> Option<TerminalSessionRecord> {
        self.records.lock().get(session_id).cloned()
    }

    pub fn has_running(&self) -> bool {
        self.records
            .lock()
            .values()
            .any(|record| record.status == TerminalSessionStatus::Running)
    }

    pub fn replace_all(&self, records: Vec<TerminalSessionRecord>) {
        let mut next = HashMap::new();
        for record in records {
            let record = normalize_session_record(record);
            next.insert(record.session_id.clone(), record);
        }
        let employee_ids = next
            .values()
            .map(|record| record.employee_id.clone())
            .collect::<Vec<_>>();
        for employee_id in employee_ids {
            prune_employee_history(&mut next, &employee_id);
        }
        *self.records.lock() = next;
    }

    pub fn fail_start(
        &self,
        session_id: &str,
        message: impl Into<String>,
    ) -> Option<TerminalSessionRecord> {
        self.update_terminal_status(
            session_id,
            TerminalSessionStatus::Failed,
            None,
            Some(TerminalStopReason::FailedToStart),
            Some(message),
        )
    }

    pub fn stop(&self, session_id: &str) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        if record.status != TerminalSessionStatus::Running {
            return Some(record.clone());
        }
        set_terminal_stopped(
            record,
            TerminalSessionStatus::Stopped,
            None,
            Some(TerminalStopReason::UserStopped),
            Some("stopped by user".to_string()),
        );
        Some(record.clone())
    }

    pub fn finish(&self, session_id: &str, exit_code: i32) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        if record.status != TerminalSessionStatus::Running {
            return None;
        }
        record.status = if exit_code == 0 {
            TerminalSessionStatus::Exited
        } else {
            TerminalSessionStatus::Failed
        };
        record.exit_code = Some(exit_code);
        let now = crate::events::now_ms();
        record.ended_at = Some(now);
        record.stopped_at = Some(now);
        record.stop_reason = Some(TerminalStopReason::Exited);
        record.message = None;
        Some(record.clone())
    }

    pub fn touch_output(&self, session_id: &str) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        record.last_output_at = Some(crate::events::now_ms());
        Some(record.clone())
    }

    pub fn rename(&self, session_id: &str, label: &str) -> Result<TerminalSessionRecord, String> {
        let label = cleaned_session_label(label)?;
        let mut records = self.records.lock();
        let record = records
            .get_mut(session_id)
            .ok_or_else(|| format!("terminal session {session_id} not found"))?;
        record.label = label;
        Ok(record.clone())
    }

    fn update_terminal_status(
        &self,
        session_id: &str,
        status: TerminalSessionStatus,
        exit_code: Option<i32>,
        stop_reason: Option<TerminalStopReason>,
        message: Option<impl Into<String>>,
    ) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        set_terminal_stopped(
            record,
            status,
            exit_code,
            stop_reason,
            message.map(Into::into),
        );
        Some(record.clone())
    }
}

pub fn restore_terminal_session_records(
    records: &[TerminalSessionRecord],
) -> Vec<TerminalSessionRecord> {
    records
        .iter()
        .cloned()
        .map(|mut record| {
            if record.status == TerminalSessionStatus::Running {
                record.status = TerminalSessionStatus::Stopped;
                record.exit_code = None;
                let now = crate::events::now_ms();
                record.ended_at = Some(now);
                record.stopped_at = Some(now);
                record.stop_reason = Some(TerminalStopReason::AppRestarted);
                record.message =
                    Some("app restarted before terminal session completed".to_string());
            }
            normalize_session_record(record)
        })
        .collect()
}

fn normalize_session_record(mut record: TerminalSessionRecord) -> TerminalSessionRecord {
    if record.label.trim().is_empty() {
        record.label = format!("{} session", record.profile.display_label());
    }
    if record.stopped_at.is_none() {
        record.stopped_at = record.ended_at;
    }
    record
}

fn set_terminal_stopped(
    record: &mut TerminalSessionRecord,
    status: TerminalSessionStatus,
    exit_code: Option<i32>,
    stop_reason: Option<TerminalStopReason>,
    message: Option<String>,
) {
    let now = crate::events::now_ms();
    record.status = status;
    record.exit_code = exit_code;
    record.ended_at = Some(now);
    record.stopped_at = Some(now);
    record.stop_reason = stop_reason;
    record.message = message;
}

fn prune_employee_history(records: &mut HashMap<String, TerminalSessionRecord>, employee_id: &str) {
    let mut employee_records = records
        .values()
        .filter(|record| record.employee_id == employee_id)
        .map(|record| {
            (
                record.session_id.clone(),
                record.started_at,
                record.status == TerminalSessionStatus::Running,
            )
        })
        .collect::<Vec<_>>();
    if employee_records.len() <= TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE {
        return;
    }

    employee_records.sort_by_key(|record| std::cmp::Reverse(record.1));
    for (session_id, _started_at, running) in employee_records
        .into_iter()
        .skip(TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE)
    {
        if !running {
            records.remove(&session_id);
        }
    }
}

fn cleaned_session_label(label: &str) -> Result<String, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("terminal session label is required".to_string());
    }
    Ok(label.chars().take(TERMINAL_LABEL_MAX_CHARS).collect())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::super::{TerminalLaunchProfile, TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE};
    use super::{
        restore_terminal_session_records, TerminalSessionRecord, TerminalSessionStatus,
        TerminalSessionStore, TerminalStopReason,
    };

    #[test]
    fn terminal_session_store_creates_and_finishes_record() {
        let store = TerminalSessionStore::default();
        let record = store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            PathBuf::from("/tmp").to_string_lossy().to_string(),
        );

        assert_eq!(record.status, TerminalSessionStatus::Running);

        let finished = store.finish("term-1", 0).unwrap();

        assert_eq!(finished.status, TerminalSessionStatus::Exited);
        assert_eq!(finished.exit_code, Some(0));
        assert_eq!(finished.stop_reason, Some(TerminalStopReason::Exited));
        assert!(finished.ended_at.is_some());
        assert!(finished.stopped_at.is_some());
    }

    #[test]
    fn terminal_session_store_lists_gets_and_filters_records() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        store.create(
            "term-2".to_string(),
            "employee-2".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );

        let employee_records = store.list(Some("employee-1"));

        assert_eq!(employee_records.len(), 1);
        assert_eq!(employee_records[0].session_id, "term-1");
        assert_eq!(store.get("term-2").unwrap().employee_id, "employee-2");
    }

    #[test]
    fn stopped_terminal_session_is_not_overwritten_by_wait_exit() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );

        let stopped = store.stop("term-1").unwrap();
        let finish_result = store.finish("term-1", 1);

        assert_eq!(stopped.status, TerminalSessionStatus::Stopped);
        assert_eq!(stopped.stop_reason, Some(TerminalStopReason::UserStopped));
        assert!(finish_result.is_none());
        assert_eq!(store.list(None)[0].status, TerminalSessionStatus::Stopped);
    }

    #[test]
    fn stopping_already_stopped_session_is_safe() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        let first_stop = store.stop("term-1").unwrap();
        let second_stop = store.stop("term-1").unwrap();

        assert_eq!(second_stop.status, TerminalSessionStatus::Stopped);
        assert_eq!(second_stop.stop_reason, first_stop.stop_reason);
        assert_eq!(second_stop.stopped_at, first_stop.stopped_at);
    }

    #[test]
    fn terminal_session_rename_trims_and_rejects_empty_labels() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );

        let renamed = store.rename("term-1", "  Build watcher  ").unwrap();

        assert_eq!(renamed.label, "Build watcher");
        assert!(store.rename("term-1", "   ").is_err());
    }

    #[test]
    fn terminal_session_history_is_capped_per_employee() {
        let store = TerminalSessionStore::default();
        let records = (0..(TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE + 5))
            .map(|index| sample_session_record("employee-1", index as u64))
            .collect::<Vec<_>>();

        store.replace_all(records);

        let records = store.list(Some("employee-1"));
        assert_eq!(records.len(), TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE);
        assert_eq!(records[0].started_at, 5);
    }

    #[test]
    fn restore_running_terminal_session_as_stopped_with_restart_message() {
        let restored = restore_terminal_session_records(&[TerminalSessionRecord {
            session_id: "term-1".to_string(),
            employee_id: "employee-1".to_string(),
            profile: TerminalLaunchProfile::Codex,
            cwd: "/tmp".to_string(),
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: 1,
            ended_at: None,
            stopped_at: None,
            stop_reason: None,
            label: String::new(),
            last_output_at: None,
            message: None,
        }]);

        assert_eq!(restored[0].status, TerminalSessionStatus::Stopped);
        assert_eq!(
            restored[0].stop_reason,
            Some(TerminalStopReason::AppRestarted)
        );
        assert_eq!(restored[0].label, "Codex session");
        assert_eq!(
            restored[0].message.as_deref(),
            Some("app restarted before terminal session completed")
        );
        assert!(restored[0].ended_at.is_some());
        assert!(restored[0].stopped_at.is_some());
    }

    fn sample_session_record(employee_id: &str, started_at: u64) -> TerminalSessionRecord {
        TerminalSessionRecord {
            session_id: format!("term-{started_at}"),
            employee_id: employee_id.to_string(),
            profile: TerminalLaunchProfile::Shell,
            cwd: "/tmp".to_string(),
            status: TerminalSessionStatus::Stopped,
            exit_code: None,
            started_at,
            ended_at: Some(started_at + 1),
            stopped_at: Some(started_at + 1),
            stop_reason: Some(TerminalStopReason::UserStopped),
            label: "Shell session".to_string(),
            last_output_at: None,
            message: None,
        }
    }
}
