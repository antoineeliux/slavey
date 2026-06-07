use std::{fs as std_fs, io::Write, path::Path};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::{events::now_ms, AppState};

const TERMINAL_IMAGE_UPLOAD_DIR: &str = ".slavey/terminal-images";
const TERMINAL_IMAGE_UPLOAD_LIMIT_MB: usize = 20;
const MAX_TERMINAL_IMAGE_UPLOAD_BYTES: usize = TERMINAL_IMAGE_UPLOAD_LIMIT_MB * 1024 * 1024;
const MAX_TERMINAL_IMAGE_UPLOAD_BASE64_CHARS: usize =
    MAX_TERMINAL_IMAGE_UPLOAD_BYTES.div_ceil(3) * 4;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalImageUploadRequest {
    pub file_name: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    pub data_base64: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalImageUploadPathRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalImageUploadResult {
    pub path: String,
    pub file_name: String,
    pub bytes: usize,
    pub mime_type: String,
}

#[tauri::command]
pub fn terminal_image_upload(
    state: State<'_, AppState>,
    payload: TerminalImageUploadRequest,
) -> Result<TerminalImageUploadResult, String> {
    let extension = image_extension(&payload.file_name, payload.mime_type.as_deref())?;
    validate_base64_payload_size(&payload.data_base64)?;
    let bytes = decode_base64_payload(&payload.data_base64)?;
    upload_image_bytes(
        state,
        &payload.file_name,
        payload.mime_type.as_deref(),
        extension,
        bytes,
    )
}

#[tauri::command]
pub fn terminal_image_upload_path(
    state: State<'_, AppState>,
    payload: TerminalImageUploadPathRequest,
) -> Result<TerminalImageUploadResult, String> {
    let source_path = Path::new(&payload.path)
        .canonicalize()
        .map_err(|error| format!("image drop path is invalid: {error}"))?;
    let file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "image drop path must include a file name".to_string())?;
    let extension = image_extension(file_name, None)?;
    let metadata = std_fs::metadata(&source_path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("image drop must be a file".to_string());
    }
    if metadata.len() > MAX_TERMINAL_IMAGE_UPLOAD_BYTES as u64 {
        return Err(format!(
            "image upload is too large; limit is {} MB",
            MAX_TERMINAL_IMAGE_UPLOAD_BYTES / 1024 / 1024
        ));
    }
    let bytes = std_fs::read(&source_path).map_err(|error| error.to_string())?;
    upload_image_bytes(state, file_name, None, extension, bytes)
}

fn decode_base64_payload(input: &str) -> Result<Vec<u8>, String> {
    let data = base64_payload(input);
    general_purpose::STANDARD
        .decode(data)
        .map_err(|error| format!("image upload decode failed: {error}"))
}

fn base64_payload(input: &str) -> &str {
    input
        .split_once(',')
        .filter(|(prefix, _)| prefix.to_ascii_lowercase().contains(";base64"))
        .map(|(_, data)| data)
        .unwrap_or(input)
        .trim()
}

fn validate_base64_payload_size(input: &str) -> Result<(), String> {
    let encoded_len = base64_payload(input).len();
    if encoded_len > MAX_TERMINAL_IMAGE_UPLOAD_BASE64_CHARS {
        return Err(format!(
            "image upload is too large; limit is {} MB",
            MAX_TERMINAL_IMAGE_UPLOAD_BYTES / 1024 / 1024
        ));
    }
    Ok(())
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = std_fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn upload_image_bytes(
    state: State<'_, AppState>,
    original_file_name: &str,
    mime_type: Option<&str>,
    extension: &'static str,
    bytes: Vec<u8>,
) -> Result<TerminalImageUploadResult, String> {
    if bytes.is_empty() {
        return Err("image upload is empty".to_string());
    }
    if bytes.len() > MAX_TERMINAL_IMAGE_UPLOAD_BYTES {
        return Err(format!(
            "image upload is too large; limit is {} MB",
            MAX_TERMINAL_IMAGE_UPLOAD_BYTES / 1024 / 1024
        ));
    }
    if !bytes_match_image_extension(extension, &bytes) {
        return Err("upload contents do not match the image type".to_string());
    }

    let workspace_root = state
        .workspace_root()
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let upload_dir = workspace_root.join(TERMINAL_IMAGE_UPLOAD_DIR);
    std_fs::create_dir_all(&upload_dir).map_err(|error| error.to_string())?;
    let upload_dir = upload_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !upload_dir.starts_with(&workspace_root) {
        return Err("image upload directory is outside the workspace".to_string());
    }

    let mime_type = normalized_image_mime(extension, mime_type);
    let file_name = uploaded_image_file_name(original_file_name, extension);
    let path = upload_dir.join(&file_name);
    write_new_file(&path, &bytes)?;

    Ok(TerminalImageUploadResult {
        path: path.to_string_lossy().to_string(),
        file_name,
        bytes: bytes.len(),
        mime_type,
    })
}

fn uploaded_image_file_name(original_name: &str, extension: &str) -> String {
    let stem = Path::new(original_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_file_stem)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "image".to_string());
    let short_uuid = Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    format!("{}-{short_uuid}-{stem}.{extension}", now_ms())
}

fn sanitize_file_stem(input: &str) -> String {
    let mut previous_dash = false;
    let mut output = String::new();
    for character in input.chars() {
        let next = if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
            Some(character.to_ascii_lowercase())
        } else if character.is_whitespace() || character == '.' {
            Some('-')
        } else {
            None
        };

        if let Some(next) = next {
            if next == '-' {
                if previous_dash {
                    continue;
                }
                previous_dash = true;
            } else {
                previous_dash = false;
            }
            output.push(next);
        }
        if output.len() >= 48 {
            break;
        }
    }
    output.trim_matches('-').to_string()
}

fn image_extension(file_name: &str, mime_type: Option<&str>) -> Result<&'static str, String> {
    let mime_extension = mime_type.and_then(extension_from_mime_type);
    if let Some(extension) = mime_extension {
        return Ok(extension);
    }

    if let Some(mime_type) = mime_type {
        let trimmed = mime_type.trim();
        if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("application/octet-stream") {
            return Err("upload must be an image file".to_string());
        }
    }

    let extension = Path::new(file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .and_then(extension_from_file_extension);
    extension.ok_or_else(|| "upload must be a supported image file".to_string())
}

fn extension_from_mime_type(mime_type: &str) -> Option<&'static str> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/png" | "image/x-png" => Some("png"),
        "image/jpeg" | "image/jpg" | "image/pjpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/heic" => Some("heic"),
        "image/heif" => Some("heif"),
        "image/tiff" | "image/x-tiff" => Some("tiff"),
        "image/bmp" | "image/x-ms-bmp" => Some("bmp"),
        _ => None,
    }
}

fn extension_from_file_extension(extension: &str) -> Option<&'static str> {
    match extension.trim().to_ascii_lowercase().as_str() {
        "png" => Some("png"),
        "jpg" | "jpeg" => Some("jpg"),
        "webp" => Some("webp"),
        "gif" => Some("gif"),
        "heic" => Some("heic"),
        "heif" => Some("heif"),
        "tif" | "tiff" => Some("tiff"),
        "bmp" => Some("bmp"),
        _ => None,
    }
}

fn bytes_match_image_extension(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "tiff" => bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*"),
        "bmp" => bytes.starts_with(b"BM"),
        "heic" | "heif" => bytes_match_heif_brand(bytes),
        _ => false,
    }
}

fn bytes_match_heif_brand(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || &bytes[4..8] != b"ftyp" {
        return false;
    }
    bytes[8..bytes.len().min(64)].chunks(4).any(|brand| {
        matches!(
            brand,
            b"heic" | b"heix" | b"hevc" | b"hevx" | b"heif" | b"mif1" | b"msf1"
        )
    })
}

fn normalized_image_mime(extension: &str, mime_type: Option<&str>) -> String {
    mime_type
        .map(str::trim)
        .filter(|mime_type| extension_from_mime_type(mime_type).is_some())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            match extension {
                "png" => "image/png",
                "jpg" => "image/jpeg",
                "webp" => "image/webp",
                "gif" => "image/gif",
                "heic" => "image/heic",
                "heif" => "image/heif",
                "tiff" => "image/tiff",
                "bmp" => "image/bmp",
                _ => "image/unknown",
            }
            .to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::{
        bytes_match_image_extension, decode_base64_payload, image_extension,
        uploaded_image_file_name, validate_base64_payload_size,
        MAX_TERMINAL_IMAGE_UPLOAD_BASE64_CHARS,
    };

    #[test]
    fn accepts_supported_image_mimes_and_extensions() {
        assert_eq!(
            image_extension("ignored.bin", Some("image/png")).unwrap(),
            "png"
        );
        assert_eq!(image_extension("screenshot.jpeg", Some("")).unwrap(), "jpg");
        assert_eq!(image_extension("photo.heic", None).unwrap(), "heic");
    }

    #[test]
    fn rejects_non_image_mimes() {
        let error = image_extension("note.png", Some("text/plain")).unwrap_err();
        assert!(error.contains("image"));
    }

    #[test]
    fn decodes_plain_base64_and_data_urls() {
        assert_eq!(decode_base64_payload("aW1hZ2U=").unwrap(), b"image");
        assert_eq!(
            decode_base64_payload("data:image/png;base64,aW1hZ2U=").unwrap(),
            b"image"
        );
        assert_eq!(
            decode_base64_payload("data:image/png;BASE64,aW1hZ2U=").unwrap(),
            b"image"
        );
    }

    #[test]
    fn rejects_oversized_base64_before_decoding() {
        let oversized = "a".repeat(MAX_TERMINAL_IMAGE_UPLOAD_BASE64_CHARS + 1);
        let error = validate_base64_payload_size(&oversized).unwrap_err();
        assert!(error.contains("too large"));
    }

    #[test]
    fn validates_image_magic_bytes() {
        assert!(bytes_match_image_extension("png", b"\x89PNG\r\n\x1a\nrest"));
        assert!(bytes_match_image_extension(
            "jpg",
            &[0xff, 0xd8, 0xff, 0xe0]
        ));
        assert!(bytes_match_image_extension("webp", b"RIFFxxxxWEBPrest"));
        assert!(!bytes_match_image_extension("png", b"not really a png"));
    }

    #[test]
    fn generated_file_name_is_sanitized() {
        let file_name = uploaded_image_file_name("../../My Screenshot!.png", "png");
        assert!(file_name.ends_with("-my-screenshot.png"));
        assert!(!file_name.contains(".."));
        assert!(!file_name.contains('/'));
    }
}
