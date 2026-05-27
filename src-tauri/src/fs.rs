use std::{fs as std_fs, io::Write, path::PathBuf};

use serde::Serialize;
use tauri::State;

use crate::AppState;

mod metadata;
mod operations;
mod path_safety;
mod search;

use self::{
    metadata::{
        file_metadata_in_workspace, fs_entry_for_path, symlink_target_entry, system_time_to_ms,
    },
    operations::delete_path_in_workspace,
    path_safety::{
        is_sensitive_path, resolve_existing_file, resolve_existing_path, resolve_new_file,
        resolve_new_path,
    },
    search::{
        clamp_depth, clamp_limit, glob_match, is_probably_binary, resolve_scan_root, scan_files,
        DEFAULT_SCAN_DEPTH,
    },
};
pub use self::{operations::write_file_in_workspace, path_safety::resolve_existing_dir};

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
pub struct FileMetadata {
    pub path: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub readonly: bool,
    pub writable: bool,
    pub is_file: bool,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub inside_workspace: bool,
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
            match symlink_target_entry(&workspace_root, &entry_path)? {
                Some(entry) => (entry.path, entry.is_dir, entry.size, entry.modified),
                None => continue,
            }
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
pub fn fs_file_metadata(state: State<'_, AppState>, path: String) -> Result<FileMetadata, String> {
    let workspace_root = state.workspace_root();
    file_metadata_in_workspace(&workspace_root, &path)
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
