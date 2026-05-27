use std::{
    fs as std_fs,
    path::{Path, PathBuf},
};

pub fn resolve_existing_dir(root: &Path, input: &str) -> Result<PathBuf, String> {
    let path = resolve_existing_path(root, input)?;
    if path.is_dir() {
        Ok(path)
    } else {
        Err("path is not a directory".to_string())
    }
}

pub(super) fn resolve_existing_file(root: &Path, input: &str) -> Result<PathBuf, String> {
    let path = resolve_existing_path(root, input)?;
    if path.is_file() {
        Ok(path)
    } else {
        Err("path is not a file".to_string())
    }
}

pub(super) fn resolve_existing_path(root: &Path, input: &str) -> Result<PathBuf, String> {
    let candidate = join_workspace_path(root, input);
    ensure_not_sensitive(&candidate)?;
    let resolved = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    ensure_inside_workspace(root, &resolved)?;
    ensure_not_sensitive(&resolved)?;
    Ok(resolved)
}

pub(super) fn resolve_writable_file(root: &Path, input: &str) -> Result<PathBuf, String> {
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

pub(super) fn resolve_new_file(root: &Path, input: &str) -> Result<PathBuf, String> {
    let path = resolve_new_path(root, input)?;
    if path.extension().is_none() && input.ends_with('/') {
        return Err("file path is not valid".to_string());
    }
    Ok(path)
}

pub(super) fn resolve_new_path(root: &Path, input: &str) -> Result<PathBuf, String> {
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

pub(super) fn resolve_deletable_path(root: &Path, input: &str) -> Result<PathBuf, String> {
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

pub(super) fn join_workspace_path(root: &Path, input: &str) -> PathBuf {
    let input_path = PathBuf::from(input);
    if input_path.is_absolute() {
        input_path
    } else {
        root.join(input_path)
    }
}

pub(super) fn ensure_inside_workspace(root: &Path, path: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if path.starts_with(&root) {
        Ok(())
    } else {
        Err("path is outside the workspace".to_string())
    }
}

pub(super) fn ensure_not_sensitive(path: &Path) -> Result<(), String> {
    if is_sensitive_path(path) {
        Err("path is blocked because it may contain secrets or credentials".to_string())
    } else {
        Ok(())
    }
}

pub(super) fn is_sensitive_path(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        is_sensitive_name(&name)
    })
}

pub(super) fn is_sensitive_name(name: &str) -> bool {
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
    use super::*;
    use crate::fs::write_file_in_workspace;

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
    fn file_ops_block_sensitive_paths() {
        let root = test_root("file-ops-sensitive");

        assert!(resolve_new_file(&root, ".env").is_err());
        assert!(resolve_new_path(&root, ".git/config").is_err());
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
}
