use std::{
    fs as std_fs,
    io::Read,
    path::{Path, PathBuf},
};

use super::{
    metadata::system_time_to_ms,
    path_safety::resolve_existing_dir,
    path_safety::{ensure_inside_workspace, ensure_not_sensitive, is_sensitive_name},
    FsEntry,
};

pub(super) const DEFAULT_SCAN_DEPTH: usize = 8;

const DEFAULT_SCAN_LIMIT: usize = 500;
const MAX_SCAN_LIMIT: usize = 5000;
const MAX_SCAN_DEPTH: usize = 16;
const MAX_GREP_FILE_BYTES: u64 = 1024 * 1024;

pub(super) fn resolve_scan_root(root: &Path, input: Option<&str>) -> Result<PathBuf, String> {
    match input {
        Some(input) if !input.trim().is_empty() => resolve_existing_dir(root, input),
        _ => Ok(root.to_path_buf()),
    }
}

pub(super) fn clamp_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_SCAN_LIMIT).clamp(1, MAX_SCAN_LIMIT)
}

pub(super) fn clamp_depth(max_depth: Option<usize>) -> usize {
    max_depth.unwrap_or(DEFAULT_SCAN_DEPTH).min(MAX_SCAN_DEPTH)
}

pub(super) fn scan_files(
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

pub(super) fn is_probably_binary(path: &Path) -> Result<bool, String> {
    let metadata = std_fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_GREP_FILE_BYTES {
        return Ok(true);
    }
    let mut file = std_fs::File::open(path).map_err(|error| error.to_string())?;
    let mut buffer = [0_u8; 1024];
    let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
    Ok(buffer[..read].contains(&0))
}

pub(super) fn glob_match(pattern: &str, value: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("slavey-fs-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
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
    fn glob_match_supports_star_and_question() {
        assert!(glob_match("*.rs", "main.rs"));
        assert!(glob_match("file-?.txt", "file-a.txt"));
        assert!(!glob_match("*.rs", "main.ts"));
    }
}
