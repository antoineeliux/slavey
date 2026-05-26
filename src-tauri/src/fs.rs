use std::{
    fs as std_fs,
    io::Write,
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde::Serialize;
use tauri::State;

use crate::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePayload {
    pub path: String,
    pub contents: String,
}

#[tauri::command]
pub fn fs_list_dir(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<Vec<FsEntry>, String> {
    let dir = match path {
        Some(path) if !path.trim().is_empty() => {
            resolve_existing_dir(&state.workspace_root, &path)?
        }
        _ => state.workspace_root.clone(),
    };

    let mut entries = Vec::new();
    for entry in std_fs::read_dir(&dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();
        if is_sensitive_path(&entry_path) {
            continue;
        }

        let metadata = std_fs::symlink_metadata(&entry_path).map_err(|error| error.to_string())?;
        let file_type = metadata.file_type();
        let (path, is_dir, size, modified) = if file_type.is_symlink() {
            let resolved = match entry_path.canonicalize() {
                Ok(resolved) => resolved,
                Err(_) => continue,
            };
            if ensure_inside_workspace(&state.workspace_root, &resolved).is_err()
                || is_sensitive_path(&resolved)
            {
                continue;
            }
            let target_metadata = match std_fs::metadata(&resolved) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            (
                resolved,
                target_metadata.is_dir(),
                target_metadata.is_file().then_some(target_metadata.len()),
                target_metadata.modified().ok().and_then(system_time_to_ms),
            )
        } else {
            let resolved = entry_path.canonicalize().unwrap_or(entry_path.clone());
            (
                resolved,
                metadata.is_dir(),
                metadata.is_file().then_some(metadata.len()),
                metadata.modified().ok().and_then(system_time_to_ms),
            )
        };

        entries.push(FsEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            is_dir,
            size,
            modified,
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub fn fs_read_file(state: State<'_, AppState>, path: String) -> Result<FilePayload, String> {
    let file = resolve_existing_file(&state.workspace_root, &path)?;
    let contents = std_fs::read_to_string(&file).map_err(|error| error.to_string())?;
    Ok(FilePayload {
        path: file.to_string_lossy().to_string(),
        contents,
    })
}

#[tauri::command]
pub fn fs_write_file(
    state: State<'_, AppState>,
    path: String,
    contents: String,
) -> Result<(), String> {
    write_file_in_workspace(&state.workspace_root, &path, &contents)
}

pub fn resolve_existing_dir(root: &Path, input: &str) -> Result<PathBuf, String> {
    let path = resolve_existing_path(root, input)?;
    if path.is_dir() {
        Ok(path)
    } else {
        Err("path is not a directory".to_string())
    }
}

fn resolve_existing_file(root: &Path, input: &str) -> Result<PathBuf, String> {
    let path = resolve_existing_path(root, input)?;
    if path.is_file() {
        Ok(path)
    } else {
        Err("path is not a file".to_string())
    }
}

fn resolve_existing_path(root: &Path, input: &str) -> Result<PathBuf, String> {
    let candidate = join_workspace_path(root, input);
    ensure_not_sensitive(&candidate)?;
    let resolved = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    ensure_inside_workspace(root, &resolved)?;
    ensure_not_sensitive(&resolved)?;
    Ok(resolved)
}

fn resolve_writable_file(root: &Path, input: &str) -> Result<PathBuf, String> {
    let candidate = join_workspace_path(root, input);
    ensure_not_sensitive(&candidate)?;
    if candidate.exists() {
        let resolved = candidate
            .canonicalize()
            .map_err(|error| error.to_string())?;
        ensure_inside_workspace(root, &resolved)?;
        ensure_not_sensitive(&resolved)?;
        if resolved.is_file() {
            return Ok(resolved);
        }
        return Err("path is not a file".to_string());
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| "file path has no parent".to_string())?;
    let resolved_parent = parent.canonicalize().map_err(|error| error.to_string())?;
    ensure_inside_workspace(root, &resolved_parent)?;
    let file_name = candidate
        .file_name()
        .ok_or_else(|| "file path has no file name".to_string())?;
    let resolved = resolved_parent.join(file_name);
    ensure_not_sensitive(&resolved)?;
    Ok(resolved)
}

fn join_workspace_path(root: &Path, input: &str) -> PathBuf {
    let input_path = PathBuf::from(input);
    if input_path.is_absolute() {
        input_path
    } else {
        root.join(input_path)
    }
}

pub fn write_file_in_workspace(root: &Path, input: &str, contents: &str) -> Result<(), String> {
    let file = resolve_writable_file(root, input)?;
    atomic_write(&file, contents)
}

fn atomic_write(file: &Path, contents: &str) -> Result<(), String> {
    let parent = file
        .parent()
        .ok_or_else(|| "file path has no parent".to_string())?;
    let file_name = file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "file path has no valid file name".to_string())?;
    let temp_path = parent.join(format!(".{}.{}.tmp", file_name, uuid::Uuid::new_v4()));
    let existing_permissions = std_fs::metadata(file)
        .ok()
        .map(|metadata| metadata.permissions());

    let result = (|| {
        let mut temp_file = std_fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| error.to_string())?;
        temp_file
            .write_all(contents.as_bytes())
            .map_err(|error| error.to_string())?;
        temp_file.sync_all().map_err(|error| error.to_string())?;
        drop(temp_file);
        if let Some(permissions) = existing_permissions.clone() {
            std_fs::set_permissions(&temp_path, permissions).map_err(|error| error.to_string())?;
        }
        std_fs::rename(&temp_path, file).map_err(|error| error.to_string())
    })();

    if result.is_err() {
        let _ = std_fs::remove_file(&temp_path);
    }

    result
}

fn ensure_inside_workspace(root: &Path, path: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if path.starts_with(&root) {
        Ok(())
    } else {
        Err("path is outside the workspace".to_string())
    }
}

fn ensure_not_sensitive(path: &Path) -> Result<(), String> {
    if is_sensitive_path(path) {
        Err("path is blocked because it may contain secrets or credentials".to_string())
    } else {
        Ok(())
    }
}

fn is_sensitive_path(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        is_sensitive_name(&name)
    })
}

fn is_sensitive_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == ".env"
        || lower.starts_with(".env.")
        || lower == ".ssh"
        || lower == ".git"
        || lower == ".npmrc"
        || lower == ".pypirc"
        || lower == "credentials"
        || lower == "id_rsa"
        || lower == "id_ed25519"
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
}

fn system_time_to_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("slavey-fs-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn valid_read_inside_workspace() {
        let root = test_root("read-inside");
        let file = root.join("inside.txt");
        std_fs::write(&file, "ok").unwrap();

        let resolved = resolve_existing_file(&root, "inside.txt").unwrap();
        assert_eq!(std_fs::read_to_string(resolved).unwrap(), "ok");
    }

    #[test]
    fn parent_escape_is_rejected() {
        let root = test_root("parent-escape");
        let outside = root.parent().unwrap().join("outside.txt");
        std_fs::write(&outside, "no").unwrap();

        let error = resolve_existing_file(&root, "../outside.txt").unwrap_err();
        assert!(error.contains("outside the workspace"));
        let _ = std_fs::remove_file(outside);
    }

    #[test]
    fn absolute_outside_path_is_rejected() {
        let root = test_root("absolute-outside");
        let outside =
            std::env::temp_dir().join(format!("slavey-outside-{}.txt", uuid::Uuid::new_v4()));
        std_fs::write(&outside, "no").unwrap();

        let error = resolve_existing_file(&root, outside.to_str().unwrap()).unwrap_err();
        assert!(error.contains("outside the workspace"));
        let _ = std_fs::remove_file(outside);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        let root = test_root("symlink-escape");
        let outside =
            std::env::temp_dir().join(format!("slavey-outside-{}.txt", uuid::Uuid::new_v4()));
        std_fs::write(&outside, "no").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link.txt")).unwrap();

        let error = resolve_existing_file(&root, "link.txt").unwrap_err();
        assert!(error.contains("outside the workspace"));
        let _ = std_fs::remove_file(outside);
    }

    #[test]
    fn env_read_and_write_are_rejected() {
        let root = test_root("env-blocked");
        std_fs::write(root.join(".env"), "SECRET=1").unwrap();

        assert!(resolve_existing_file(&root, ".env").is_err());
        assert!(write_file_in_workspace(&root, ".env", "SECRET=2").is_err());
        assert!(write_file_in_workspace(&root, ".env.local", "SECRET=2").is_err());
    }

    #[test]
    fn git_config_read_and_write_are_rejected() {
        let root = test_root("git-blocked");
        let git_dir = root.join(".git");
        std_fs::create_dir_all(&git_dir).unwrap();
        std_fs::write(git_dir.join("config"), "secret").unwrap();

        assert!(resolve_existing_file(&root, ".git/config").is_err());
        assert!(write_file_in_workspace(&root, ".git/config", "secret").is_err());
    }

    #[test]
    fn private_key_like_filename_is_rejected() {
        let root = test_root("key-blocked");
        std_fs::write(root.join("id_ed25519"), "secret").unwrap();
        std_fs::write(root.join("deploy.pem"), "secret").unwrap();

        assert!(resolve_existing_file(&root, "id_ed25519").is_err());
        assert!(resolve_existing_file(&root, "deploy.pem").is_err());
        assert!(write_file_in_workspace(&root, "deploy.key", "secret").is_err());
    }

    #[test]
    fn valid_new_file_write_inside_workspace_is_accepted() {
        let root = test_root("write-inside");

        write_file_in_workspace(&root, "nested.txt", "ok").unwrap();

        assert_eq!(
            std_fs::read_to_string(root.join("nested.txt")).unwrap(),
            "ok"
        );
    }

    #[cfg(unix)]
    #[test]
    fn executable_permissions_are_preserved_on_save() {
        use std::os::unix::fs::PermissionsExt;

        let root = test_root("permission-preserve");
        let script = root.join("run.sh");
        std_fs::write(&script, "#!/bin/sh\necho before\n").unwrap();
        let mut permissions = std_fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o755);
        std_fs::set_permissions(&script, permissions).unwrap();

        write_file_in_workspace(&root, "run.sh", "#!/bin/sh\necho after\n").unwrap();

        let mode = std_fs::metadata(&script).unwrap().permissions().mode();
        assert_eq!(mode & 0o111, 0o111);
    }
}
