use std::{
    fs as std_fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde::Serialize;
use tauri::State;

use crate::AppState;

const DEFAULT_SCAN_LIMIT: usize = 500;
const MAX_SCAN_LIMIT: usize = 5000;
const DEFAULT_SCAN_DEPTH: usize = 8;
const MAX_SCAN_DEPTH: usize = 16;
const MAX_GREP_FILE_BYTES: u64 = 1024 * 1024;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchResult {
    pub path: String,
    pub line_number: Option<u64>,
    pub line: Option<String>,
}

#[tauri::command]
pub fn fs_list_dir(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<Vec<FsEntry>, String> {
    let workspace_root = state.workspace_root();
    let dir = match path {
        Some(path) if !path.trim().is_empty() => resolve_existing_dir(&workspace_root, &path)?,
        _ => workspace_root.clone(),
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
            if ensure_inside_workspace(&workspace_root, &resolved).is_err()
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
    let workspace_root = state.workspace_root();
    let file = resolve_existing_file(&workspace_root, &path)?;
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
    let workspace_root = state.workspace_root();
    write_file_in_workspace(&workspace_root, &path, &contents)
}

#[tauri::command]
pub fn fs_list_files(
    state: State<'_, AppState>,
    root: Option<String>,
    limit: Option<usize>,
    max_depth: Option<usize>,
) -> Result<Vec<FsEntry>, String> {
    let workspace_root = state.workspace_root();
    let root = resolve_scan_root(&workspace_root, root.as_deref())?;
    let mut files = Vec::new();
    scan_files(
        &workspace_root,
        &root,
        0,
        clamp_depth(max_depth),
        clamp_limit(limit),
        &mut files,
    )?;
    Ok(files)
}

#[tauri::command]
pub fn fs_search(
    state: State<'_, AppState>,
    query: String,
    root: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<FsSearchResult>, String> {
    let query = query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let workspace_root = state.workspace_root();
    let root = resolve_scan_root(&workspace_root, root.as_deref())?;
    let mut files = Vec::new();
    scan_files(
        &workspace_root,
        &root,
        0,
        DEFAULT_SCAN_DEPTH,
        clamp_limit(limit),
        &mut files,
    )?;
    Ok(files
        .into_iter()
        .filter(|entry| entry.name.to_ascii_lowercase().contains(&query))
        .take(clamp_limit(limit))
        .map(|entry| FsSearchResult {
            path: entry.path,
            line_number: None,
            line: None,
        })
        .collect())
}

#[tauri::command]
pub fn fs_grep(
    state: State<'_, AppState>,
    pattern: String,
    root: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<FsSearchResult>, String> {
    let pattern = pattern.trim().to_string();
    if pattern.is_empty() {
        return Ok(Vec::new());
    }
    let limit = clamp_limit(limit);
    let workspace_root = state.workspace_root();
    let root = resolve_scan_root(&workspace_root, root.as_deref())?;
    let mut files = Vec::new();
    scan_files(
        &workspace_root,
        &root,
        0,
        DEFAULT_SCAN_DEPTH,
        limit.saturating_mul(4).max(limit),
        &mut files,
    )?;

    let mut results = Vec::new();
    for file in files {
        if results.len() >= limit {
            break;
        }
        let path = PathBuf::from(&file.path);
        if is_probably_binary(&path)? {
            continue;
        }
        let contents = match std_fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(_) => continue,
        };
        for (index, line) in contents.lines().enumerate() {
            if line.contains(&pattern) {
                results.push(FsSearchResult {
                    path: file.path.clone(),
                    line_number: Some((index + 1) as u64),
                    line: Some(line.chars().take(500).collect()),
                });
                if results.len() >= limit {
                    break;
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn fs_glob(
    state: State<'_, AppState>,
    pattern: String,
    root: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<FsSearchResult>, String> {
    let pattern = pattern.trim().to_string();
    if pattern.is_empty() {
        return Ok(Vec::new());
    }
    let workspace_root = state.workspace_root();
    let root = resolve_scan_root(&workspace_root, root.as_deref())?;
    let mut files = Vec::new();
    scan_files(
        &workspace_root,
        &root,
        0,
        DEFAULT_SCAN_DEPTH,
        clamp_limit(limit),
        &mut files,
    )?;
    Ok(files
        .into_iter()
        .filter(|entry| glob_match(&pattern, &entry.path) || glob_match(&pattern, &entry.name))
        .take(clamp_limit(limit))
        .map(|entry| FsSearchResult {
            path: entry.path,
            line_number: None,
            line: None,
        })
        .collect())
}

#[tauri::command]
pub fn fs_create_file(
    state: State<'_, AppState>,
    path: String,
    contents: Option<String>,
) -> Result<FilePayload, String> {
    let workspace_root = state.workspace_root();
    let file = resolve_new_file(&workspace_root, &path)?;
    let contents = contents.unwrap_or_default();
    let mut handle = std_fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
        .map_err(|error| error.to_string())?;
    handle
        .write_all(contents.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(FilePayload {
        path: file.to_string_lossy().to_string(),
        contents,
    })
}

#[tauri::command]
pub fn fs_create_dir(state: State<'_, AppState>, path: String) -> Result<FsEntry, String> {
    let workspace_root = state.workspace_root();
    let dir = resolve_new_path(&workspace_root, &path)?;
    std_fs::create_dir(&dir).map_err(|error| error.to_string())?;
    fs_entry_for_path(&dir)
}

#[tauri::command]
pub fn fs_rename(state: State<'_, AppState>, from: String, to: String) -> Result<FsEntry, String> {
    let workspace_root = state.workspace_root();
    let source = resolve_existing_path(&workspace_root, &from)?;
    let target = resolve_new_path(&workspace_root, &to)?;
    std_fs::rename(&source, &target).map_err(|error| error.to_string())?;
    fs_entry_for_path(&target)
}

#[tauri::command]
pub fn fs_delete(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let workspace_root = state.workspace_root();
    delete_path_in_workspace(&workspace_root, &path)
}

fn delete_path_in_workspace(root: &Path, path: &str) -> Result<(), String> {
    let target = resolve_deletable_path(root, path)?;
    let metadata = std_fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || metadata.is_file() {
        std_fs::remove_file(&target).map_err(|error| error.to_string())
    } else if metadata.is_dir() {
        let mut entries = std_fs::read_dir(&target).map_err(|error| error.to_string())?;
        if entries
            .next()
            .transpose()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Err(
                "directory is not empty; recursive delete must go through a future approved action"
                    .to_string(),
            );
        }
        std_fs::remove_dir(&target).map_err(|error| error.to_string())
    } else {
        Err("path is not a file or directory".to_string())
    }
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

fn resolve_scan_root(root: &Path, input: Option<&str>) -> Result<PathBuf, String> {
    match input {
        Some(input) if !input.trim().is_empty() => resolve_existing_dir(root, input),
        _ => Ok(root.to_path_buf()),
    }
}

fn clamp_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_SCAN_LIMIT).clamp(1, MAX_SCAN_LIMIT)
}

fn clamp_depth(max_depth: Option<usize>) -> usize {
    max_depth.unwrap_or(DEFAULT_SCAN_DEPTH).min(MAX_SCAN_DEPTH)
}

fn scan_files(
    workspace_root: &Path,
    dir: &Path,
    depth: usize,
    max_depth: usize,
    limit: usize,
    files: &mut Vec<FsEntry>,
) -> Result<(), String> {
    if files.len() >= limit || depth > max_depth {
        return Ok(());
    }

    for entry in std_fs::read_dir(dir).map_err(|error| error.to_string())? {
        if files.len() >= limit {
            break;
        }
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if is_sensitive_name(&name) || is_ignored_scan_dir(&name) {
            continue;
        }

        let metadata = std_fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let resolved = path.canonicalize().map_err(|error| error.to_string())?;
        ensure_inside_workspace(workspace_root, &resolved)?;
        ensure_not_sensitive(&resolved)?;

        if metadata.is_dir() {
            scan_files(
                workspace_root,
                &resolved,
                depth + 1,
                max_depth,
                limit,
                files,
            )?;
        } else if metadata.is_file() {
            files.push(FsEntry {
                name,
                path: resolved.to_string_lossy().to_string(),
                is_dir: false,
                size: Some(metadata.len()),
                modified: metadata.modified().ok().and_then(system_time_to_ms),
            });
        }
    }

    Ok(())
}

fn is_ignored_scan_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".slavey"
            | "node_modules"
            | "dist"
            | "build"
            | "target"
            | ".next"
            | ".turbo"
            | ".cache"
    )
}

fn is_probably_binary(path: &Path) -> Result<bool, String> {
    let metadata = std_fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_GREP_FILE_BYTES {
        return Ok(true);
    }
    let mut file = std_fs::File::open(path).map_err(|error| error.to_string())?;
    let mut buffer = [0_u8; 1024];
    let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
    Ok(buffer[..read].contains(&0))
}

fn glob_match(pattern: &str, value: &str) -> bool {
    glob_match_bytes(pattern.as_bytes(), value.as_bytes())
}

fn glob_match_bytes(pattern: &[u8], value: &[u8]) -> bool {
    let (mut p, mut v) = (0, 0);
    let mut star = None;
    let mut match_index = 0;

    while v < value.len() {
        if p < pattern.len() && (pattern[p] == b'?' || pattern[p] == value[v]) {
            p += 1;
            v += 1;
        } else if p < pattern.len() && pattern[p] == b'*' {
            star = Some(p);
            match_index = v;
            p += 1;
        } else if let Some(star_index) = star {
            p = star_index + 1;
            match_index += 1;
            v = match_index;
        } else {
            return false;
        }
    }

    while p < pattern.len() && pattern[p] == b'*' {
        p += 1;
    }
    p == pattern.len()
}

fn resolve_new_file(root: &Path, input: &str) -> Result<PathBuf, String> {
    let path = resolve_new_path(root, input)?;
    if path.extension().is_none() && input.ends_with('/') {
        return Err("file path is not valid".to_string());
    }
    Ok(path)
}

fn resolve_new_path(root: &Path, input: &str) -> Result<PathBuf, String> {
    let candidate = join_workspace_path(root, input);
    ensure_not_sensitive(&candidate)?;
    if candidate.exists() {
        return Err("target path already exists".to_string());
    }
    let parent = candidate
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;
    let parent = parent.canonicalize().map_err(|error| error.to_string())?;
    ensure_inside_workspace(root, &parent)?;
    ensure_not_sensitive(&parent)?;
    let file_name = candidate
        .file_name()
        .ok_or_else(|| "path has no file name".to_string())?;
    let resolved = parent.join(file_name);
    ensure_not_sensitive(&resolved)?;
    Ok(resolved)
}

fn resolve_deletable_path(root: &Path, input: &str) -> Result<PathBuf, String> {
    let candidate = join_workspace_path(root, input);
    ensure_not_sensitive(&candidate)?;
    let metadata = std_fs::symlink_metadata(&candidate).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        let parent = candidate
            .parent()
            .ok_or_else(|| "path has no parent".to_string())?
            .canonicalize()
            .map_err(|error| error.to_string())?;
        ensure_inside_workspace(root, &parent)?;
        return Ok(candidate);
    }
    resolve_existing_path(root, input)
}

fn fs_entry_for_path(path: &Path) -> Result<FsEntry, String> {
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

    #[test]
    fn scan_rejects_workspace_escape() {
        let root = test_root("scan-escape");

        let error = resolve_scan_root(&root, Some("../")).unwrap_err();

        assert!(error.contains("outside the workspace"));
    }

    #[test]
    fn scan_skips_ignored_directories() {
        let root = test_root("scan-ignored");
        std_fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std_fs::create_dir_all(root.join("src")).unwrap();
        std_fs::write(root.join("node_modules/pkg/hidden.js"), "no").unwrap();
        std_fs::write(root.join("src/visible.rs"), "yes").unwrap();
        let mut files = Vec::new();

        scan_files(&root, &root, 0, DEFAULT_SCAN_DEPTH, 20, &mut files).unwrap();

        let paths = files
            .iter()
            .map(|entry| entry.path.clone())
            .collect::<Vec<_>>();
        assert!(paths.iter().any(|path| path.ends_with("visible.rs")));
        assert!(!paths.iter().any(|path| path.contains("node_modules")));
    }

    #[test]
    fn file_ops_create_rename_delete_safe_file() {
        let root = test_root("file-ops");

        let file = resolve_new_file(&root, "a.txt").unwrap();
        std_fs::write(&file, "ok").unwrap();
        let renamed = resolve_new_path(&root, "b.txt").unwrap();
        std_fs::rename(&file, &renamed).unwrap();
        let deletable = resolve_deletable_path(&root, "b.txt").unwrap();
        std_fs::remove_file(deletable).unwrap();

        assert!(!root.join("b.txt").exists());
    }

    #[test]
    fn delete_file_is_allowed() {
        let root = test_root("delete-file");
        std_fs::write(root.join("delete-me.txt"), "ok").unwrap();

        delete_path_in_workspace(&root, "delete-me.txt").unwrap();

        assert!(!root.join("delete-me.txt").exists());
    }

    #[test]
    fn delete_empty_dir_is_allowed() {
        let root = test_root("delete-empty-dir");
        std_fs::create_dir(root.join("empty")).unwrap();

        delete_path_in_workspace(&root, "empty").unwrap();

        assert!(!root.join("empty").exists());
    }

    #[test]
    fn delete_non_empty_dir_is_rejected() {
        let root = test_root("delete-non-empty-dir");
        std_fs::create_dir(root.join("full")).unwrap();
        std_fs::write(root.join("full/file.txt"), "ok").unwrap();

        let error = delete_path_in_workspace(&root, "full").unwrap_err();

        assert!(error.contains("recursive delete must go through a future approved action"));
        assert!(root.join("full/file.txt").exists());
    }

    #[test]
    fn delete_sensitive_path_is_rejected() {
        let root = test_root("delete-sensitive");
        std_fs::write(root.join(".env"), "SECRET=1").unwrap();

        assert!(delete_path_in_workspace(&root, ".env").is_err());
        assert!(root.join(".env").exists());
    }

    #[cfg(unix)]
    #[test]
    fn delete_symlink_removes_link_not_outside_target() {
        let root = test_root("delete-symlink");
        let outside =
            std::env::temp_dir().join(format!("slavey-outside-{}.txt", uuid::Uuid::new_v4()));
        std_fs::write(&outside, "keep").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("outside-link")).unwrap();

        delete_path_in_workspace(&root, "outside-link").unwrap();

        assert!(!root.join("outside-link").exists());
        assert_eq!(std_fs::read_to_string(&outside).unwrap(), "keep");
        let _ = std_fs::remove_file(outside);
    }

    #[test]
    fn file_ops_block_sensitive_paths() {
        let root = test_root("file-ops-sensitive");

        assert!(resolve_new_file(&root, ".env").is_err());
        assert!(resolve_new_path(&root, ".git/config").is_err());
    }

    #[test]
    fn glob_match_supports_star_and_question() {
        assert!(glob_match("*.rs", "main.rs"));
        assert!(glob_match("file-?.txt", "file-a.txt"));
        assert!(!glob_match("*.rs", "main.ts"));
    }
}
