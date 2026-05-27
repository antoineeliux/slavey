use std::{
    fs as std_fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use super::{
    path_safety::{
        ensure_inside_workspace, ensure_not_sensitive, is_sensitive_path, join_workspace_path,
    },
    FileMetadata, FsEntry,
};

pub(super) struct ResolvedEntryMetadata {
    pub(super) path: PathBuf,
    pub(super) is_dir: bool,
    pub(super) size: Option<u64>,
    pub(super) modified: Option<u64>,
}

pub(super) fn file_metadata_in_workspace(root: &Path, input: &str) -> Result<FileMetadata, String> {
    let candidate = join_workspace_path(root, input);
    ensure_not_sensitive(&candidate)?;
    let link_metadata = std_fs::symlink_metadata(&candidate).map_err(|error| error.to_string())?;
    let is_symlink = link_metadata.file_type().is_symlink();
    let resolved = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    ensure_inside_workspace(root, &resolved)?;
    ensure_not_sensitive(&resolved)?;

    let metadata = std_fs::metadata(&candidate).map_err(|error| error.to_string())?;
    let file_type = metadata.file_type();
    let readonly = metadata.permissions().readonly();
    Ok(FileMetadata {
        path: resolved.to_string_lossy().to_string(),
        size: file_type.is_file().then_some(metadata.len()),
        modified: metadata.modified().ok().and_then(system_time_to_ms),
        readonly,
        writable: !readonly,
        is_file: file_type.is_file(),
        is_dir: file_type.is_dir(),
        is_symlink,
        inside_workspace: true,
    })
}

pub(super) fn fs_entry_for_path(path: &Path) -> Result<FsEntry, String> {
    let metadata = std_fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    Ok(FsEntry {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string()),
        path: path.to_string_lossy().to_string(),
        is_dir: metadata.is_dir(),
        size: metadata.is_file().then_some(metadata.len()),
        modified: metadata.modified().ok().and_then(system_time_to_ms),
    })
}

pub(super) fn symlink_target_entry(
    workspace_root: &Path,
    entry_path: &Path,
) -> Result<Option<ResolvedEntryMetadata>, String> {
    if is_sensitive_path(entry_path) {
        return Ok(None);
    }
    let resolved = match entry_path.canonicalize() {
        Ok(resolved) => resolved,
        Err(_) => return Ok(None),
    };
    if ensure_inside_workspace(workspace_root, &resolved).is_err() || is_sensitive_path(&resolved) {
        return Ok(None);
    }
    let target_metadata = match std_fs::metadata(&resolved) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(None),
    };
    Ok(Some(ResolvedEntryMetadata {
        path: resolved,
        is_dir: target_metadata.is_dir(),
        size: target_metadata.is_file().then_some(target_metadata.len()),
        modified: target_metadata.modified().ok().and_then(system_time_to_ms),
    }))
}

pub(super) fn system_time_to_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("slavey-fs-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn file_metadata_reports_safe_file_state() {
        let root = test_root("metadata-file");
        std_fs::write(root.join("inside.txt"), "hello").unwrap();

        let metadata = file_metadata_in_workspace(&root, "inside.txt").unwrap();

        assert!(metadata.path.ends_with("inside.txt"));
        assert_eq!(metadata.size, Some(5));
        assert!(metadata.modified.is_some());
        assert!(metadata.writable);
        assert!(!metadata.readonly);
        assert!(metadata.is_file);
        assert!(!metadata.is_dir);
        assert!(!metadata.is_symlink);
        assert!(metadata.inside_workspace);
    }

    #[test]
    fn file_metadata_rejects_workspace_escape() {
        let root = test_root("metadata-escape");
        let outside =
            std::env::temp_dir().join(format!("slavey-outside-{}.txt", uuid::Uuid::new_v4()));
        std_fs::write(&outside, "no").unwrap();

        let error = file_metadata_in_workspace(&root, outside.to_str().unwrap()).unwrap_err();

        assert!(error.contains("outside the workspace"));
        let _ = std_fs::remove_file(outside);
    }

    #[cfg(unix)]
    #[test]
    fn file_metadata_reports_symlink_to_safe_target() {
        let root = test_root("metadata-symlink");
        std_fs::write(root.join("target.txt"), "ok").unwrap();
        std::os::unix::fs::symlink(root.join("target.txt"), root.join("link.txt")).unwrap();

        let metadata = file_metadata_in_workspace(&root, "link.txt").unwrap();

        assert!(metadata.is_file);
        assert!(metadata.is_symlink);
        assert!(metadata.inside_workspace);
    }
}
