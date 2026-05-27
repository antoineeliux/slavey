use std::{
    fs as std_fs,
    io::Read,
    path::{Path, PathBuf},
};

use super::{parsing::is_untracked_file, worktree::path_to_str};

const MAX_UNTRACKED_PREVIEW_BYTES: usize = 64 * 1024;

pub(super) fn resolve_safe_worktree_relative_path(
    worktree: &Path,
    input: &str,
) -> Result<String, String> {
    let relative = resolve_worktree_relative_path(worktree, input)?;
    ensure_not_sensitive_git_path(&relative)?;
    Ok(relative)
}

fn resolve_worktree_relative_path(worktree: &Path, input: &str) -> Result<String, String> {
    let input_path = PathBuf::from(input);
    if input_path.is_absolute() {
        let resolved = if input_path.exists() {
            input_path
                .canonicalize()
                .map_err(|error| error.to_string())?
        } else {
            return Err("absolute path must exist inside the worktree".to_string());
        };
        ensure_path_inside(worktree, &resolved)?;
        return path_to_str(
            resolved
                .strip_prefix(worktree)
                .map_err(|_| "path is outside the worktree".to_string())?,
        )
        .map(ToString::to_string);
    }

    let candidate = worktree.join(input_path);
    if candidate.exists() {
        let resolved = candidate
            .canonicalize()
            .map_err(|error| error.to_string())?;
        ensure_path_inside(worktree, &resolved)?;
        return path_to_str(
            resolved
                .strip_prefix(worktree)
                .map_err(|_| "path is outside the worktree".to_string())?,
        )
        .map(ToString::to_string);
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    ensure_path_inside(worktree, &parent)?;
    let file_name = candidate
        .file_name()
        .ok_or_else(|| "path has no file name".to_string())?;
    let resolved = parent.join(file_name);
    ensure_path_inside(worktree, &resolved)?;
    path_to_str(
        resolved
            .strip_prefix(worktree)
            .map_err(|_| "path is outside the worktree".to_string())?,
    )
    .map(ToString::to_string)
}

pub(super) fn remove_untracked_file(
    worktree: &Path,
    status: &[String],
    input: &str,
) -> Result<(), String> {
    let relative = resolve_safe_worktree_relative_path(worktree, input)?;
    if !is_untracked_file(status, &relative) {
        return Err("file is not untracked".to_string());
    }

    let target = worktree.join(&relative);
    let metadata = std_fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        return Err("untracked directory deletion is not supported".to_string());
    }
    if metadata.file_type().is_symlink() || metadata.is_file() {
        std_fs::remove_file(&target).map_err(|error| error.to_string())
    } else {
        Err("untracked path is not a file".to_string())
    }
}

pub(super) fn untracked_file_preview(worktree: &Path, relative: &str) -> Result<String, String> {
    let path = worktree.join(relative);
    let resolved = path.canonicalize().map_err(|error| error.to_string())?;
    ensure_path_inside(worktree, &resolved)?;
    let metadata = std_fs::metadata(&resolved).map_err(|error| error.to_string())?;
    let header = format!("untracked file preview\npath: {relative}\nstatus: untracked\n\n");

    if !metadata.is_file() {
        return Ok(format!("{header}[untracked path is not a regular file]"));
    }

    if metadata.len() > MAX_UNTRACKED_PREVIEW_BYTES as u64 {
        return Ok(format!(
            "{header}[file is too large to preview: {} bytes]",
            metadata.len()
        ));
    }

    let mut file = std_fs::File::open(&resolved).map_err(|error| error.to_string())?;
    let mut contents = Vec::new();
    file.by_ref()
        .take((MAX_UNTRACKED_PREVIEW_BYTES + 1) as u64)
        .read_to_end(&mut contents)
        .map_err(|error| error.to_string())?;

    if contents.contains(&0) {
        return Ok(format!("{header}[binary file omitted from preview]"));
    }

    if contents.len() > MAX_UNTRACKED_PREVIEW_BYTES {
        contents.truncate(MAX_UNTRACKED_PREVIEW_BYTES);
        return Ok(format!(
            "{}{} \n[preview truncated at {} bytes]",
            header,
            String::from_utf8_lossy(&contents),
            MAX_UNTRACKED_PREVIEW_BYTES
        ));
    }

    Ok(format!("{header}{}", String::from_utf8_lossy(&contents)))
}

fn ensure_path_inside(root: &Path, path: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("path is outside the worktree".to_string())
    }
}

fn ensure_not_sensitive_git_path(path: &str) -> Result<(), String> {
    if path.split(['/', '\\']).any(is_sensitive_name) {
        Err("path is blocked because it may contain secrets or credentials".to_string())
    } else {
        Ok(())
    }
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

#[cfg(test)]
mod tests {
    use std::{fs as std_fs, path::PathBuf};

    use super::{
        remove_untracked_file, resolve_safe_worktree_relative_path, untracked_file_preview,
    };
    use crate::git::parse_status_lines;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("slavey-git-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn untracked_preview_includes_bounded_text_content() {
        let root = test_root("untracked-preview");
        std_fs::write(root.join("new.txt"), "hello\nworld\n").unwrap();

        let preview = untracked_file_preview(&root, "new.txt").unwrap();

        assert!(preview.contains("untracked file preview"));
        assert!(preview.contains("path: new.txt"));
        assert!(preview.contains("hello\nworld"));
    }

    #[test]
    fn untracked_preview_rejects_paths_outside_worktree() {
        let root = test_root("untracked-preview-outside");
        let outside = root
            .parent()
            .unwrap()
            .join(format!("slavey-git-outside-{}.txt", uuid::Uuid::new_v4()));
        std_fs::write(&outside, "outside").unwrap();

        let error = untracked_file_preview(&root, outside.to_str().unwrap()).unwrap_err();

        assert!(error.contains("outside the worktree"));
        let _ = std_fs::remove_file(outside);
    }

    #[test]
    fn untracked_preview_omits_binary_content() {
        let root = test_root("untracked-preview-binary");
        std_fs::write(root.join("binary.bin"), b"abc\0def").unwrap();

        let preview = untracked_file_preview(&root, "binary.bin").unwrap();

        assert!(preview.contains("binary file omitted"));
    }

    #[test]
    fn worktree_relative_path_rejects_parent_escape_for_destructive_ops() {
        let root = test_root("destructive-path-outside");
        let outside = root
            .parent()
            .unwrap()
            .join(format!("slavey-git-outside-{}.txt", uuid::Uuid::new_v4()));
        std_fs::write(&outside, "outside").unwrap();

        let error =
            resolve_safe_worktree_relative_path(&root, outside.to_str().unwrap()).unwrap_err();

        assert!(error.contains("outside the worktree"));
        let _ = std_fs::remove_file(outside);
    }

    #[test]
    fn worktree_relative_path_rejects_sensitive_paths_for_destructive_ops() {
        let root = test_root("destructive-path-sensitive");
        std_fs::write(root.join(".env"), "SECRET=1").unwrap();

        let error = resolve_safe_worktree_relative_path(&root, ".env").unwrap_err();

        assert!(error.contains("secrets or credentials"));
    }

    #[test]
    fn untracked_file_delete_removes_only_status_marked_file() {
        let root = test_root("untracked-delete");
        std_fs::write(root.join("scratch.txt"), "temporary").unwrap();
        let status = parse_status_lines("?? scratch.txt\n");

        remove_untracked_file(&root, &status, "scratch.txt").unwrap();

        assert!(!root.join("scratch.txt").exists());
    }

    #[test]
    fn untracked_file_delete_rejects_tracked_or_unknown_file() {
        let root = test_root("untracked-delete-reject");
        std_fs::write(root.join("tracked.txt"), "keep").unwrap();
        let status = parse_status_lines(" M tracked.txt\n");

        let error = remove_untracked_file(&root, &status, "tracked.txt").unwrap_err();

        assert!(error.contains("not untracked"));
        assert!(root.join("tracked.txt").exists());
    }

    #[test]
    fn untracked_file_delete_rejects_directories() {
        let root = test_root("untracked-delete-dir");
        std_fs::create_dir(root.join("scratch-dir")).unwrap();
        let status = parse_status_lines("?? scratch-dir/\n");

        let error = remove_untracked_file(&root, &status, "scratch-dir").unwrap_err();

        assert!(error.contains("directory deletion is not supported"));
        assert!(root.join("scratch-dir").exists());
    }
}
