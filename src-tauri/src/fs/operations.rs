use std::{fs as std_fs, io::Write, path::Path};

use super::path_safety::{resolve_deletable_path, resolve_writable_file};

pub fn write_file_in_workspace(root: &Path, input: &str, contents: &str) -> Result<(), String> {
    let file = resolve_writable_file(root, input)?;
    atomic_write(&file, contents)
}

pub(super) fn delete_path_in_workspace(root: &Path, path: &str) -> Result<(), String> {
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
}
