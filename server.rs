//! ChronoFlow — static file server
//! stdlib only, no external crates, single-threaded (desktop single-user).
//!
//! Build:  rustc server.rs -o server        (macOS / Linux)
//!         rustc server.rs -o server.exe    (Windows)
//! Run:    ./server          (default port 3000)
//!         ./server 8080     (custom port)
//! Then open: http://localhost:3000

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DATA_FILE: &str = "data.json";
const VERSIONS_DIR: &str = ".versions";

/// Files the AI may never write without explicit user unlock
const LOCKED_FILES: &[&str] = &["js/app.js", "js/state.js", "js/utils.js"];

/// Paths the file-write API will accept (prefix whitelist)
const WRITE_PREFIXES: &[&str] = &["js/", "css/"];
/// Root-level HTML files also writable
const WRITE_HTML_SUFFIX: &str = ".html";

// ---------------------------------------------------------------------------
// Default data.json skeleton
// ---------------------------------------------------------------------------
const DEFAULT_DATA: &str = r#"{
  "tasks": [],
  "slots": [],
  "scheduleBlocks": [],
  "focusSessions": [],
  "settings": {},
  "goals": [],
  "subtasks": [],
  "gmailConfig": {},
  "aiConfig": {},
  "registeredAiJobs": [],
  "unlockedFiles": []
}"#;

// ---------------------------------------------------------------------------
// Runtime state (single-threaded, no mutex needed)
// ---------------------------------------------------------------------------
struct ServerState {
    root: PathBuf,
    /// Files temporarily unlocked for this server session
    unlocked_files: Vec<String>,
}

impl ServerState {
    fn new(root: PathBuf) -> Self {
        Self { root, unlocked_files: Vec::new() }
    }

    fn data_path(&self) -> PathBuf { self.root.join(DATA_FILE) }
    fn versions_dir(&self) -> PathBuf { self.root.join(VERSIONS_DIR) }

    fn ensure_data_file(&self) {
        let p = self.data_path();
        if !p.exists() {
            let _ = fs::write(&p, DEFAULT_DATA);
        }
    }

    fn is_write_allowed(&self, rel_path: &str) -> bool {
        let is_whitelisted = WRITE_PREFIXES.iter().any(|pfx| rel_path.starts_with(pfx))
            || (rel_path.ends_with(WRITE_HTML_SUFFIX) && !rel_path.contains('/'));
        if !is_whitelisted { return false; }
        if LOCKED_FILES.contains(&rel_path) {
            return self.unlocked_files.iter().any(|f| f == rel_path);
        }
        true
    }
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------
fn mime(ext: &str) -> &'static str {
    match ext {
        "html" | "htm" => "text/html; charset=utf-8",
        "css"          => "text/css; charset=utf-8",
        "js"           => "application/javascript; charset=utf-8",
        "json"         => "application/json; charset=utf-8",
        "svg"          => "image/svg+xml",
        "ico"          => "image/x-icon",
        "png"          => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "woff2"        => "font/woff2",
        "woff"         => "font/woff",
        "ttf"          => "font/ttf",
        "txt"          => "text/plain; charset=utf-8",
        _              => "application/octet-stream",
    }
}

// ---------------------------------------------------------------------------
// HTTP request parser — returns (method, path, query, body)
// ---------------------------------------------------------------------------
fn parse_request(stream: &TcpStream) -> Option<(String, String, String, Vec<u8>)> {
    let mut reader = BufReader::new(stream);

    // Read first line
    let mut first_line = String::new();
    reader.read_line(&mut first_line).ok()?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?.to_uppercase();
    let full_path = parts.next()?.to_owned();

    let (path, query) = if let Some(q) = full_path.find('?') {
        (full_path[..q].to_owned(), full_path[q+1..].to_owned())
    } else {
        (full_path, String::new())
    };

    // Read headers
    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).ok()?;
        if line == "\r\n" || line == "\n" || line.is_empty() { break; }
        let lower = line.to_lowercase();
        if lower.starts_with("content-length:") {
            content_length = lower["content-length:".len()..].trim().parse().unwrap_or(0);
        }
    }

    // Read body
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        let _ = reader.read_exact(&mut body);
    }

    Some((method, path, query, body))
}

// ---------------------------------------------------------------------------
// Query string parser — returns value for a key
// ---------------------------------------------------------------------------
fn query_get<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let mut kv = pair.splitn(2, '=');
        let k = kv.next()?;
        if k == key { kv.next() } else { None }
    })
}

// ---------------------------------------------------------------------------
// Percent decoder
// ---------------------------------------------------------------------------
fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i+1]), hex_val(bytes[i+2])) {
                out.push(char::from(h << 4 | l));
                i += 3; continue;
            }
        }
        if bytes[i] == b'+' { out.push(' '); }
        else { out.push(char::from(bytes[i])); }
        i += 1;
    }
    out
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Static file resolver (blocks path traversal)
// ---------------------------------------------------------------------------
fn resolve_static(root: &Path, url_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(url_path);
    let rel = decoded.trim_start_matches('/');
    let candidate = if rel.is_empty() { root.join("index.html") } else { root.join(rel) };
    let canonical  = candidate.canonicalize().ok()?;
    let root_canon = root.canonicalize().ok()?;
    if !canonical.starts_with(&root_canon) { return None; }
    if canonical.is_dir() {
        let index = canonical.join("index.html");
        if index.exists() { Some(index) } else { None }
    } else {
        Some(canonical)
    }
}

// ---------------------------------------------------------------------------
// HTTP response helpers
// ---------------------------------------------------------------------------
fn respond(mut stream: TcpStream, status: u16, reason: &str, ct: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {ct}\r\n\
         Content-Length: {}\r\n\
         Cache-Control: no-cache\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, DELETE, PATCH, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         \r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

fn json_ok(stream: TcpStream, body: &str) {
    respond(stream, 200, "OK", "application/json; charset=utf-8", body.as_bytes());
}

fn json_err(stream: TcpStream, status: u16, msg: &str) {
    let body = format!(r#"{{"error":"{msg}"}}"#);
    respond(stream, status, "Error", "application/json; charset=utf-8", body.as_bytes());
}

fn respond_404(stream: TcpStream, path: &str) {
    let body = format!(
        "<!doctype html><title>404</title>\
         <style>body{{font-family:monospace;background:#070a12;color:#eef1ff;\
         display:grid;place-items:center;min-height:100vh;margin:0}}</style>\
         <h1>404 &mdash; Not Found</h1><p><code>{path}</code></p>\
         <p><a href='/' style='color:#74f0d3'>&larr; Home</a></p>"
    );
    respond(stream, 404, "Not Found", "text/html; charset=utf-8", body.as_bytes());
}

// ---------------------------------------------------------------------------
// Minimal JSON helpers (no serde — stdlib only)
// ---------------------------------------------------------------------------

/// Extract a top-level string field from a flat JSON object.
fn json_str_field<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("\"{}\":", key);
    let start = json.find(&needle)? + needle.len();
    let rest = json[start..].trim_start();
    if rest.starts_with('"') {
        let inner = &rest[1..];
        let end = inner.find('"')?;
        Some(&inner[..end])
    } else {
        None
    }
}

/// Extract a top-level bool field.
fn json_bool_field(json: &str, key: &str) -> Option<bool> {
    let needle = format!("\"{}\":", key);
    let start = json.find(&needle)? + needle.len();
    let rest = json[start..].trim_start();
    if rest.starts_with("true")  { Some(true)  }
    else if rest.starts_with("false") { Some(false) }
    else { None }
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

// GET /api/ping
fn handle_ping(stream: TcpStream) {
    json_ok(stream, r#"{"ok":true,"app":"chronoflow"}"#);
}

// GET /api/data  or  GET /api/data?store=tasks
fn handle_data_get(stream: TcpStream, query: &str, state: &ServerState) {
    state.ensure_data_file();
    let raw = match fs::read_to_string(state.data_path()) {
        Ok(s) => s,
        Err(_) => { json_err(stream, 500, "Cannot read data.json"); return; }
    };

    if let Some(store) = query_get(query, "store") {
        // Return just that store's array
        let needle = format!("\"{}\":", store);
        if let Some(pos) = raw.find(&needle) {
            let after = raw[pos + needle.len()..].trim_start();
            // find matching bracket
            let (open, close) = if after.starts_with('[') { ('[', ']') } else { ('{', '}') };
            let mut depth = 0usize;
            let mut end = 0usize;
            for (i, ch) in after.char_indices() {
                if ch == open  { depth += 1; }
                if ch == close { depth -= 1; if depth == 0 { end = i + 1; break; } }
            }
            json_ok(stream, &after[..end]);
        } else {
            json_ok(stream, "[]");
        }
    } else {
        json_ok(stream, &raw);
    }
}

// POST /api/data?store=tasks  — body is the new array for that store
fn handle_data_post(stream: TcpStream, query: &str, body: &[u8], state: &ServerState) {
    state.ensure_data_file();
    let store = match query_get(query, "store") {
        Some(s) => s.to_owned(),
        None    => { json_err(stream, 400, "Missing store param"); return; }
    };
    let new_value = match std::str::from_utf8(body) {
        Ok(s) => s.trim().to_owned(),
        Err(_) => { json_err(stream, 400, "Invalid UTF-8 body"); return; }
    };

    let raw = fs::read_to_string(state.data_path()).unwrap_or_else(|_| DEFAULT_DATA.to_owned());

    let needle = format!("\"{}\":", store);
    let updated = if let Some(pos) = raw.find(&needle) {
        let after = raw[pos + needle.len()..].trim_start();
        let (open, close) = if after.starts_with('[') { ('[', ']') }
                            else if after.starts_with('{') { ('{', '}') }
                            else { ('[', ']') };
        let mut depth = 0usize;
        let mut end = 0usize;
        for (i, ch) in after.char_indices() {
            if ch == open  { depth += 1; }
            if ch == close { depth -= 1; if depth == 0 { end = i + ch.len_utf8(); break; } }
        }
        // replace old value with new
        let old_start = pos + needle.len() + (raw[pos+needle.len()..].len() - after.len());
        format!("{}{}{}", &raw[..old_start], new_value, &raw[old_start + end..])
    } else {
        // store not found — append before closing brace
        let trimmed = raw.trim_end();
        if trimmed.ends_with('}') {
            format!("{},\n  \"{}\": {}\n}}", &trimmed[..trimmed.len()-1], store, new_value)
        } else {
            raw.clone()
        }
    };

    match fs::write(state.data_path(), &updated) {
        Ok(_)  => json_ok(stream, r#"{"ok":true}"#),
        Err(e) => json_err(stream, 500, &e.to_string()),
    }
}

// GET /api/files?path=js/planner.js
fn handle_files_get(stream: TcpStream, query: &str, state: &ServerState) {
    let rel = match query_get(query, "path") {
        Some(p) => percent_decode(p),
        None    => { json_err(stream, 400, "Missing path param"); return; }
    };
    let full = state.root.join(&rel);
    // safety: must stay in root
    match full.canonicalize() {
        Ok(canon) => {
            let root_canon = state.root.canonicalize().unwrap();
            if !canon.starts_with(&root_canon) {
                json_err(stream, 403, "Path outside project root"); return;
            }
            match fs::read_to_string(&canon) {
                Ok(contents) => {
                    // return as JSON: { "path": "...", "content": "..." }
                    let escaped = contents.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r");
                    let body = format!(r#"{{"path":"{rel}","content":"{escaped}"}}"#);
                    json_ok(stream, &body);
                }
                Err(_) => json_err(stream, 404, "File not found or not readable"),
            }
        }
        Err(_) => json_err(stream, 404, "File not found"),
    }
}

// POST /api/files  — body: { "path": "js/foo.js", "content": "..." }
fn handle_files_post(stream: TcpStream, body: &[u8], state: &ServerState) {
    let body_str = match std::str::from_utf8(body) {
        Ok(s) => s,
        Err(_) => { json_err(stream, 400, "Invalid UTF-8"); return; }
    };
    let rel = match json_str_field(body_str, "path") {
        Some(p) => p.to_owned(),
        None    => { json_err(stream, 400, "Missing path field"); return; }
    };
    let content = match json_str_field(body_str, "content") {
        Some(c) => c.replace("\\n", "\n").replace("\\r", "\r").replace("\\\"", "\"").replace("\\\\", "\\"),
        None    => { json_err(stream, 400, "Missing content field"); return; }
    };

    if !state.is_write_allowed(&rel) {
        if LOCKED_FILES.contains(&rel.as_str()) {
            json_err(stream, 403, "File is locked. Unlock it first via /api/unlock");
        } else {
            json_err(stream, 403, "Path not in write whitelist (js/, css/, *.html)");
        }
        return;
    }

    let full = state.root.join(&rel);
    if let Some(parent) = full.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::write(&full, &content) {
        Ok(_)  => json_ok(stream, r#"{"ok":true}"#),
        Err(e) => json_err(stream, 500, &e.to_string()),
    }
}

// GET /api/versions — list saved versions
fn handle_versions_list(stream: TcpStream, state: &ServerState) {
    let dir = state.versions_dir();
    let _ = fs::create_dir_all(&dir);
    let mut entries: Vec<String> = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().into_owned();
                // read meta if present
                let meta_path = entry.path().join("meta.json");
                let meta = fs::read_to_string(&meta_path).unwrap_or_else(|_| "{}".to_owned());
                entries.push(format!(r#"{{"name":"{name}","meta":{meta}}}"#));
            }
        }
    }
    entries.sort();
    let body = format!("[{}]", entries.join(","));
    json_ok(stream, &body);
}

// POST /api/versions/snapshot?name=my-version  — copy live files into .versions/{name}/
fn handle_versions_snapshot(stream: TcpStream, query: &str, state: &ServerState) {
    let raw_name = query_get(query, "name").unwrap_or("snapshot");
    let name = sanitise_version_name(raw_name);
    let dest = state.versions_dir().join(&name);
    let _ = fs::create_dir_all(&dest);

    let errors = copy_project_files(&state.root, &dest);
    // write meta
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs()).unwrap_or(0);
    let meta = format!(r#"{{"createdAt":{ts},"auto":false}}"#);
    let _ = fs::write(dest.join("meta.json"), &meta);

    if errors.is_empty() {
        json_ok(stream, &format!(r#"{{"ok":true,"name":"{name}"}}"#));
    } else {
        json_err(stream, 500, &format!("Partial copy: {}", errors.join("; ")));
    }
}

// POST /api/versions/restore?name=my-version  — copy .versions/{name}/ back to live
fn handle_versions_restore(stream: TcpStream, query: &str, state: &ServerState) {
    let raw_name = match query_get(query, "name") {
        Some(n) => n,
        None    => { json_err(stream, 400, "Missing name param"); return; }
    };
    let name = sanitise_version_name(raw_name);
    let src  = state.versions_dir().join(&name);
    if !src.exists() { json_err(stream, 404, "Version not found"); return; }

    let errors = copy_project_files(&src, &state.root);
    if errors.is_empty() {
        json_ok(stream, r#"{"ok":true}"#);
    } else {
        json_err(stream, 500, &format!("Partial restore: {}", errors.join("; ")));
    }
}

// DELETE /api/versions?name=my-version
fn handle_versions_delete(stream: TcpStream, query: &str, state: &ServerState) {
    let raw_name = match query_get(query, "name") {
        Some(n) => n,
        None    => { json_err(stream, 400, "Missing name param"); return; }
    };
    let name = sanitise_version_name(raw_name);
    let dir  = state.versions_dir().join(&name);
    if !dir.exists() { json_err(stream, 404, "Version not found"); return; }
    match fs::remove_dir_all(&dir) {
        Ok(_)  => json_ok(stream, r#"{"ok":true}"#),
        Err(e) => json_err(stream, 500, &e.to_string()),
    }
}

// PATCH /api/versions?name=old&newName=new
fn handle_versions_rename(stream: TcpStream, query: &str, state: &ServerState) {
    let old = match query_get(query, "name")    { Some(n) => sanitise_version_name(n), None => { json_err(stream, 400, "Missing name");    return; } };
    let new = match query_get(query, "newName") { Some(n) => sanitise_version_name(n), None => { json_err(stream, 400, "Missing newName"); return; } };
    let src  = state.versions_dir().join(&old);
    let dest = state.versions_dir().join(&new);
    if !src.exists() { json_err(stream, 404, "Version not found"); return; }
    match fs::rename(&src, &dest) {
        Ok(_)  => json_ok(stream, r#"{"ok":true}"#),
        Err(e) => json_err(stream, 500, &e.to_string()),
    }
}

// POST /api/unlock  — body: { "file": "js/app.js", "confirm": true }
fn handle_unlock(stream: TcpStream, body: &[u8], state: &mut ServerState) {
    let body_str = match std::str::from_utf8(body) {
        Ok(s) => s,
        Err(_) => { json_err(stream, 400, "Invalid UTF-8"); return; }
    };
    let file    = match json_str_field(body_str, "file")    { Some(f) => f.to_owned(), None => { json_err(stream, 400, "Missing file field");    return; } };
    let confirm = json_bool_field(body_str, "confirm").unwrap_or(false);
    if !confirm { json_err(stream, 400, "confirm must be true"); return; }
    if !LOCKED_FILES.contains(&file.as_str()) {
        json_err(stream, 400, "File is not in the locked list"); return;
    }
    if !state.unlocked_files.contains(&file) {
        state.unlocked_files.push(file.clone());
    }
    println!("  ⚠  Unlocked: {file}");
    json_ok(stream, &format!(r#"{{"ok":true,"file":"{file}","warning":"This file is now writable for this server session only."}}""));
}

// ---------------------------------------------------------------------------
// Version file copy helper — copies js/, css/, *.html, data.json
// ---------------------------------------------------------------------------
fn copy_project_files(src: &Path, dest: &Path) -> Vec<String> {
    let mut errors = Vec::new();
    let copy_dirs = ["js", "css"];
    let copy_root_exts = ["html", "json"];

    // Copy subdirectories
    for dir in &copy_dirs {
        let s = src.join(dir);
        let d = dest.join(dir);
        if s.exists() {
            let _ = fs::create_dir_all(&d);
            if let Ok(rd) = fs::read_dir(&s) {
                for entry in rd.flatten() {
                    let to = d.join(entry.file_name());
                    if let Err(e) = fs::copy(entry.path(), &to) {
                        errors.push(format!("{}: {e}", entry.path().display()));
                    }
                }
            }
        }
    }

    // Copy root-level html + data.json (skip .versions itself)
    if let Ok(rd) = fs::read_dir(src) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if copy_root_exts.contains(&ext) {
                    let to = dest.join(entry.file_name());
                    if let Err(e) = fs::copy(&path, &to) {
                        errors.push(format!("{}: {e}", path.display()));
                    }
                }
            }
        }
    }
    errors
}

// ---------------------------------------------------------------------------
// Version name sanitiser (no path separators, no special chars)
// ---------------------------------------------------------------------------
fn sanitise_version_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .take(64)
        .collect()
}

// ---------------------------------------------------------------------------
// Main request dispatcher
// ---------------------------------------------------------------------------
fn handle(stream: TcpStream, state: &mut ServerState) {
    let (method, path, query, body) = match parse_request(&stream) {
        Some(r) => r,
        None    => return,
    };

    println!("  {}  {}{}", method, path, if query.is_empty() { String::new() } else { format!("?{query}") });

    // CORS preflight
    if method == "OPTIONS" {
        respond(stream, 204, "No Content", "text/plain", b"");
        return;
    }

    // ---- API routes --------------------------------------------------------
    match (method.as_str(), path.as_str()) {

        // Ping
        ("GET", "/api/ping") => handle_ping(stream),

        // Data store
        ("GET",  "/api/data") => handle_data_get(stream, &query, state),
        ("POST", "/api/data") => handle_data_post(stream, &query, &body, state),

        // File read/write
        ("GET",  "/api/files") => handle_files_get(stream, &query, state),
        ("POST", "/api/files") => handle_files_post(stream, &body, state),

        // Versions
        ("GET",    "/api/versions")          => handle_versions_list(stream, state),
        ("POST",   "/api/versions/snapshot") => handle_versions_snapshot(stream, &query, state),
        ("POST",   "/api/versions/restore")  => handle_versions_restore(stream, &query, state),
        ("DELETE", "/api/versions")          => handle_versions_delete(stream, &query, state),
        ("PATCH",  "/api/versions")          => handle_versions_rename(stream, &query, state),

        // Unlock locked files
        ("POST", "/api/unlock") => handle_unlock(stream, &body, state),

        // ---- Static files --------------------------------------------------
        _ => {
            match resolve_static(&state.root, &path) {
                Some(file_path) => {
                    match fs::read(&file_path) {
                        Ok(bytes) => {
                            let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                            respond(stream, 200, "OK", mime(ext), &bytes);
                        }
                        Err(_) => respond(stream, 500, "Internal Server Error", "text/plain", b"500"),
                    }
                }
                None => respond_404(stream, &path),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
fn main() {
    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);

    let root = std::env::current_dir()
        .expect("Cannot determine current directory");

    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr)
        .unwrap_or_else(|e| { eprintln!("Cannot bind {}: {}", addr, e); std::process::exit(1); });

    println!("\n  \u{2713} ChronoFlow server running");
    println!("  \u{2192} http://localhost:{}", port);
    println!("  Serving: {}", root.display());
    println!("  Press Ctrl+C to stop\n");

    let mut state = ServerState::new(root);
    state.ensure_data_file();

    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => handle(stream, &mut state),
            Err(e)     => eprintln!("Connection error: {}", e),
        }
    }
}
