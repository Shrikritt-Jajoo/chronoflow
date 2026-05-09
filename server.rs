//! ChronoFlow development server
//!
//! Compile:  rustc server.rs -o server
//! Run:      ./server          (serves on http://localhost:4000)
//!
//! API surface
//! -----------
//! GET  /api/ping                        → 200 OK
//! GET  /api/data?store=<name>           → JSON array for that store
//! POST /api/data?store=<name>           → replace store with body JSON
//! GET  /api/files?path=<rel>            → { "content": "..." }
//! POST /api/files                       → { path, content } → write file
//! GET  /api/versions                   → [ { name, savedAt } ]
//! POST /api/versions/snapshot?name=<n> → create snapshot
//! POST /api/versions/restore?name=<n>  → restore snapshot
//! PATCH /api/versions?name=<n>&newName=<m> → rename snapshot
//! DELETE /api/versions?name=<n>        → delete snapshot
//! POST /api/unlock                     → { file, confirm } → unlock file

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

// ---- Constants ----------------------------------------------------------
const PORT: u16         = 4000;
const DATA_FILE: &str   = "data.json";
const VERSIONS_DIR: &str = ".versions";

// Files that require explicit unlock before writing
const DEFAULT_LOCKED: &[&str] = &["js/app.js", "js/state.js", "js/utils.js"];

// ---- Shared server state ------------------------------------------------
#[derive(Default)]
struct ServerState {
    unlocked_files: HashSet<String>,
}

type SharedState = Arc<Mutex<ServerState>>;

// ---- Entry point --------------------------------------------------------
fn main() {
    let addr = format!("127.0.0.1:{PORT}");
    let listener = TcpListener::bind(&addr).expect("Failed to bind port");
    println!("ChronoFlow server • http://localhost:{PORT}");
    println!("Press Ctrl+C to stop.\n");

    // Ensure data.json exists
    if !Path::new(DATA_FILE).exists() {
        fs::write(DATA_FILE, "{}\n").expect("Could not create data.json");
        println!("Created {DATA_FILE}");
    }
    // Ensure .versions/ exists
    fs::create_dir_all(VERSIONS_DIR).expect("Could not create .versions/");

    let state: SharedState = Arc::new(Mutex::new(ServerState::default()));

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let state = Arc::clone(&state);
                std::thread::spawn(move || handle_connection(s, state));
            }
            Err(e) => eprintln!("Connection error: {e}"),
        }
    }
}

// ---- HTTP request handling ---------------------------------------------
fn handle_connection(mut stream: TcpStream, state: SharedState) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));

    // --- Parse request line
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() { return; }
    let parts: Vec<&str> = request_line.trim().splitn(3, ' ').collect();
    if parts.len() < 2 { return; }
    let method = parts[0].to_string();
    let raw_path = parts[1].to_string();

    // --- Parse headers
    let mut headers: HashMap<String, String> = HashMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() { break; }
        let line = line.trim();
        if line.is_empty() { break; }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }

    // --- Read body if present
    let body = if let Some(len_str) = headers.get("content-length") {
        let len: usize = len_str.parse().unwrap_or(0);
        let mut buf = vec![0u8; len];
        let _ = reader.read_exact(&mut buf);
        String::from_utf8_lossy(&buf).to_string()
    } else {
        String::new()
    };

    // --- Split path and query string
    let (path, query) = raw_path
        .split_once('?')
        .map(|(p, q)| (p.to_string(), q.to_string()))
        .unwrap_or_else(|| (raw_path.clone(), String::new()));

    let params = parse_query(&query);

    // --- Route
    let response = route(&method, &path, &params, &body, &state);
    let _ = stream.write_all(response.as_bytes());
}

// ---- Router -------------------------------------------------------------
fn route(
    method: &str,
    path: &str,
    params: &HashMap<String, String>,
    body: &str,
    state: &SharedState,
) -> String {
    // CORS preflight
    if method == "OPTIONS" {
        return ok_response("text/plain", "", Some(cors_headers()));
    }

    match (method, path) {
        // ---- Ping
        ("GET", "/api/ping") => ok_json("{\"ok\":true}"),

        // ---- Data store
        ("GET", "/api/data") => {
            let store = params.get("store").cloned().unwrap_or_default();
            match read_store(&store) {
                Ok(data) => ok_json(&data),
                Err(e)   => error_response(500, &e),
            }
        }
        ("POST", "/api/data") => {
            let store = params.get("store").cloned().unwrap_or_default();
            match write_store(&store, body) {
                Ok(_)  => ok_json("{\"ok\":true}"),
                Err(e) => error_response(500, &e),
            }
        }

        // ---- File read/write
        ("GET", "/api/files") => {
            let rel = params.get("path").cloned().unwrap_or_default();
            match safe_read_file(&rel) {
                Ok(content) => ok_json(&format!("{{\"content\":{}}}",
                    serde_escape_json_string(&content))),
                Err(e) => error_response(404, &e),
            }
        }
        ("POST", "/api/files") => {
            // Body: { "path": "...", "content": "..." }
            let rel  = json_str_field(body, "path");
            let content = json_str_field(body, "content");
            if rel.is_empty() {
                return error_response(400, "missing path");
            }
            // Locked file check
            {
                let s = state.lock().unwrap();
                if DEFAULT_LOCKED.contains(&rel.as_str()) && !s.unlocked_files.contains(&rel) {
                    return error_response(403, &format!("{rel} is locked. Use /api/unlock first."));
                }
            }
            match safe_write_file(&rel, &content) {
                Ok(_)  => ok_json("{\"ok\":true}"),
                Err(e) => error_response(500, &e),
            }
        }

        // ---- Versions
        ("GET", "/api/versions") => {
            match list_versions() {
                Ok(json) => ok_json(&json),
                Err(e)   => error_response(500, &e),
            }
        }
        ("POST", "/api/versions/snapshot") => {
            let name = params.get("name").cloned().unwrap_or_else(|| {
                format!("snapshot-{}", unix_ts())
            });
            match create_snapshot(&name) {
                Ok(_)  => ok_json(&format!("{{\"name\":\"{name}\"}}")  ),
                Err(e) => error_response(500, &e),
            }
        }
        ("POST", "/api/versions/restore") => {
            let name = params.get("name").cloned().unwrap_or_default();
            match restore_snapshot(&name) {
                Ok(_)  => ok_json("{\"ok\":true}"),
                Err(e) => error_response(500, &e),
            }
        }
        ("PATCH", "/api/versions") | ("DELETE", "/api/versions") => {
            let name = params.get("name").cloned().unwrap_or_default();
            if method == "DELETE" {
                let vdir = PathBuf::from(VERSIONS_DIR).join(&name);
                if vdir.exists() { let _ = fs::remove_dir_all(&vdir); }
                ok_json("{\"ok\":true}")
            } else {
                let new_name = params.get("newName").cloned().unwrap_or_default();
                let old_dir  = PathBuf::from(VERSIONS_DIR).join(&name);
                let new_dir  = PathBuf::from(VERSIONS_DIR).join(&new_name);
                if old_dir.exists() {
                    let _ = fs::rename(&old_dir, &new_dir);
                }
                ok_json("{\"ok\":true}")
            }
        }

        // ---- Unlock
        ("POST", "/api/unlock") => {
            let file    = json_str_field(body, "file");
            let confirm = json_bool_field(body, "confirm");
            if confirm && !file.is_empty() {
                state.lock().unwrap().unlocked_files.insert(file.clone());
                ok_json(&format!("{{\"unlocked\":\"{file}\"}}"))
            } else {
                error_response(400, "confirm must be true")
            }
        }

        // ---- Static file fallback
        _ => serve_static(path),
    }
}

// ---- Data store helpers ------------------------------------------------

fn read_all_data() -> Result<serde_json::Value, String> {
    let raw = fs::read_to_string(DATA_FILE).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_all_data(data: &serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(DATA_FILE, json + "\n").map_err(|e| e.to_string())
}

fn read_store(store: &str) -> Result<String, String> {
    if store.is_empty() { return Err("store name required".into()); }
    let data = read_all_data()?;
    let val  = data.get(store).cloned().unwrap_or(serde_json::Value::Array(vec![]));
    serde_json::to_string(&val).map_err(|e| e.to_string())
}

fn write_store(store: &str, body: &str) -> Result<(), String> {
    if store.is_empty() { return Err("store name required".into()); }
    let new_val: serde_json::Value =
        serde_json::from_str(body).map_err(|e| e.to_string())?;
    let mut data = read_all_data().unwrap_or_else(|_| serde_json::json!({}));
    data[store] = new_val;
    write_all_data(&data)
}

// ---- File helpers -------------------------------------------------------

fn safe_path(rel: &str) -> Result<PathBuf, String> {
    let base = std::env::current_dir().map_err(|e| e.to_string())?;
    let full = base.join(rel);
    // Prevent path traversal
    if !full.starts_with(&base) {
        return Err("Path traversal not allowed".into());
    }
    Ok(full)
}

fn safe_read_file(rel: &str) -> Result<String, String> {
    let p = safe_path(rel)?;
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

fn safe_write_file(rel: &str, content: &str) -> Result<(), String> {
    let p = safe_path(rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

// ---- Version helpers ----------------------------------------------------

fn unix_ts() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Snapshot: copy js/, css/, *.html, data.json into .versions/<name>/
fn create_snapshot(name: &str) -> Result<(), String> {
    let dest = PathBuf::from(VERSIONS_DIR).join(name);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    // Write metadata
    let meta = format!("{{\"name\":\"{name}\",\"savedAt\":\"{}\"}}",
        chrono_now_iso());
    fs::write(dest.join("meta.json"), meta).map_err(|e| e.to_string())?;

    // Copy data.json
    if Path::new(DATA_FILE).exists() {
        fs::copy(DATA_FILE, dest.join(DATA_FILE)).map_err(|e| e.to_string())?;
    }

    // Copy js/, css/, *.html
    copy_dir_recursive(Path::new("js"),  &dest.join("js"))?;
    copy_dir_recursive(Path::new("css"), &dest.join("css"))?;

    // Copy all .html in root
    for entry in fs::read_dir(".").map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("html") {
            if let Some(fname) = p.file_name() {
                fs::copy(&p, dest.join(fname)).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Restore: overwrite working tree from .versions/<name>/
fn restore_snapshot(name: &str) -> Result<(), String> {
    let src = PathBuf::from(VERSIONS_DIR).join(name);
    if !src.exists() {
        return Err(format!("Version \"{name}\" not found"));
    }

    // Restore data.json
    let src_data = src.join(DATA_FILE);
    if src_data.exists() {
        fs::copy(&src_data, DATA_FILE).map_err(|e| e.to_string())?;
    }

    // Restore js/ and css/
    copy_dir_recursive(&src.join("js"),  Path::new("js"))?;
    copy_dir_recursive(&src.join("css"), Path::new("css"))?;

    // Restore .html files
    for entry in fs::read_dir(&src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("html") {
            if let Some(fname) = p.file_name() {
                fs::copy(&p, fname).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

fn list_versions() -> Result<String, String> {
    let dir = Path::new(VERSIONS_DIR);
    if !dir.exists() { return Ok("[]".into()); }

    let mut versions: Vec<(String, String)> = vec![];

    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            let meta_path = entry.path().join("meta.json");
            let saved_at = if meta_path.exists() {
                let raw = fs::read_to_string(&meta_path).unwrap_or_default();
                json_str_field(&raw, "savedAt")
            } else {
                String::new()
            };
            versions.push((name, saved_at));
        }
    }

    // Sort newest first
    versions.sort_by(|a, b| b.1.cmp(&a.1));

    let items: Vec<String> = versions
        .iter()
        .map(|(n, s)| format!("{{\"name\":\"{n}\",\"savedAt\":\"{s}\"}}" ))
        .collect();
    Ok(format!("[{}]", items.join(",")))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() { return Ok(()); }
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry  = entry.map_err(|e| e.to_string())?;
        let src_p  = entry.path();
        let dst_p  = dst.join(entry.file_name());
        if src_p.is_dir() {
            copy_dir_recursive(&src_p, &dst_p)?;
        } else {
            fs::copy(&src_p, &dst_p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ---- Static file server ------------------------------------------------

fn serve_static(path: &str) -> String {
    let rel = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
    let full = PathBuf::from(rel);

    // Block directory traversal
    if rel.contains("..") {
        return error_response(403, "Forbidden");
    }

    match fs::read(&full) {
        Ok(bytes) => {
            let mime = mime_type(rel);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\n\
                 Content-Length: {}\r\nCache-Control: no-cache\r\n\
                 {}\r\n",
                bytes.len(),
                cors_headers()
            );
            let mut response = header.into_bytes();
            response.extend_from_slice(&bytes);
            String::from_utf8_lossy(&response).to_string()
        }
        Err(_) => error_response(404, "Not found"),
    }
}

fn mime_type(path: &str) -> &'static str {
    if path.ends_with(".html")       { "text/html; charset=utf-8" }
    else if path.ends_with(".css")   { "text/css; charset=utf-8" }
    else if path.ends_with(".js")    { "application/javascript; charset=utf-8" }
    else if path.ends_with(".json")  { "application/json" }
    else if path.ends_with(".svg")   { "image/svg+xml" }
    else if path.ends_with(".png")   { "image/png" }
    else if path.ends_with(".ico")   { "image/x-icon" }
    else if path.ends_with(".woff2") { "font/woff2" }
    else                             { "application/octet-stream" }
}

// ---- Response builders -------------------------------------------------

fn ok_json(body: &str) -> String {
    ok_response("application/json", body, None)
}

fn ok_response(content_type: &str, body: &str, extra_headers: Option<String>) -> String {
    let extra = extra_headers.unwrap_or_else(|| cors_headers());
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n\
         Content-Length: {}\r\n{extra}\r\n{body}",
        body.len()
    )
}

fn error_response(code: u16, msg: &str) -> String {
    let body = format!("{{\"error\":\"{msg}\"}}");
    format!(
        "HTTP/1.1 {code} Error\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\n{}\r\n{body}",
        body.len(),
        cors_headers()
    )
}

fn cors_headers() -> String {
    "Access-Control-Allow-Origin: *\r\n\
     Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS\r\n\
     Access-Control-Allow-Headers: Content-Type\r\n".to_string()
}

// ---- Tiny JSON helpers (no external crates) ----------------------------

// Minimal JSON pulled from a "serde_json" stand-in using std only
// We re-use serde_json::Value via the trick of writing our own subset:
// Actually for this file we use the real serde_json crate.
// Add to your Cargo.toml if using Cargo:
//   [dependencies]
//   serde_json = "1"
// OR compile with:
//   rustc server.rs -o server  (requires serde_json in your build env)
// For zero-dependency build, replace serde_json calls with the
// hand-rolled helpers below.

mod serde_json {
    use std::collections::HashMap;

    #[derive(Clone, Debug)]
    pub enum Value {
        Null,
        Bool(bool),
        Number(f64),
        Str(String),
        Array(Vec<Value>),
        Object(HashMap<String, Value>),
    }

    impl Value {
        pub fn get(&self, key: &str) -> Option<&Value> {
            if let Value::Object(m) = self { m.get(key) } else { None }
        }
    }

    impl std::ops::Index<&str> for Value {
        type Output = Value;
        fn index(&self, key: &str) -> &Value {
            static NULL: Value = Value::Null;
            self.get(key).unwrap_or(&NULL)
        }
    }
    impl std::ops::IndexMut<&str> for Value {
        fn index_mut(&mut self, key: &str) -> &mut Value {
            if let Value::Object(m) = self {
                m.entry(key.to_string()).or_insert(Value::Null)
            } else { panic!("not an object") }
        }
    }

    pub fn from_str(s: &str) -> Result<Value, String> {
        parse(s.trim())
    }

    pub fn to_string(v: &Value) -> Result<String, String> {
        Ok(encode(v))
    }
    pub fn to_string_pretty(v: &Value) -> Result<String, String> {
        Ok(encode_pretty(v, 0))
    }

    pub fn json(s: &str) -> Value {
        from_str(s).unwrap_or(Value::Null)
    }

    // ---- Encoder -------------------------------------------------------
    fn encode(v: &Value) -> String {
        match v {
            Value::Null        => "null".into(),
            Value::Bool(b)     => b.to_string(),
            Value::Number(n)   => {
                if n.fract() == 0.0 && n.abs() < 1e15 { format!("{}", *n as i64) }
                else { format!("{n}") }
            }
            Value::Str(s)      => format!("\"{}\"", escape_str(s)),
            Value::Array(a)    => format!("[{}]", a.iter().map(encode).collect::<Vec<_>>().join(",")),
            Value::Object(m)   => {
                let pairs: Vec<String> = m.iter()
                    .map(|(k, v)| format!("\"{}\": {}", escape_str(k), encode(v)))
                    .collect();
                format!("{{{}}}", pairs.join(","))
            }
        }
    }
    fn encode_pretty(v: &Value, indent: usize) -> String {
        let pad = "  ".repeat(indent);
        let pad1 = "  ".repeat(indent + 1);
        match v {
            Value::Array(a) => {
                if a.is_empty() { return "[]".into(); }
                let items: Vec<String> = a.iter().map(|i| format!("{pad1}{}", encode_pretty(i, indent+1))).collect();
                format!("[\n{}\n{pad}]", items.join(",\n"))
            }
            Value::Object(m) => {
                if m.is_empty() { return "{}".into(); }
                let pairs: Vec<String> = m.iter()
                    .map(|(k, val)| format!("{pad1}\"{}\": {}", escape_str(k), encode_pretty(val, indent+1)))
                    .collect();
                format!("{{{\n}{}\n{pad}}}", pairs.join(",\n"))
            }
            other => encode(other),
        }
    }
    fn escape_str(s: &str) -> String {
        s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r").replace('\t', "\\t")
    }

    // ---- Parser --------------------------------------------------------
    fn parse(s: &str) -> Result<Value, String> {
        let (val, rest) = parse_value(s)?;
        if !rest.trim().is_empty() { return Err(format!("trailing: {rest}")); }
        Ok(val)
    }
    fn parse_value(s: &str) -> Result<(Value, &str), String> {
        let s = s.trim_start();
        if s.starts_with('"') { parse_string(s) }
        else if s.starts_with('{') { parse_object(s) }
        else if s.starts_with('[') { parse_array(s) }
        else if s.starts_with("true")  { Ok((Value::Bool(true),  &s[4..])) }
        else if s.starts_with("false") { Ok((Value::Bool(false), &s[5..])) }
        else if s.starts_with("null")  { Ok((Value::Null,        &s[4..])) }
        else { parse_number(s) }
    }
    fn parse_string(s: &str) -> Result<(Value, &str), String> {
        let bytes = s.as_bytes();
        let mut i = 1; // skip opening "
        let mut result = String::new();
        while i < bytes.len() {
            match bytes[i] {
                b'"' => { return Ok((Value::Str(result), &s[i+1..])); }
                b'\\' => {
                    i += 1;
                    match bytes.get(i) {
                        Some(b'"')  => result.push('"'),
                        Some(b'\\') => result.push('\\'),
                        Some(b'n')  => result.push('\n'),
                        Some(b'r')  => result.push('\r'),
                        Some(b't')  => result.push('\t'),
                        _ => result.push(bytes[i] as char),
                    }
                }
                c => result.push(c as char),
            }
            i += 1;
        }
        Err("unterminated string".into())
    }
    fn parse_number(s: &str) -> Result<(Value, &str), String> {
        let end = s.find(|c: char| !c.is_ascii_digit() && c != '.' && c != '-' && c != 'e' && c != 'E' && c != '+')
            .unwrap_or(s.len());
        let num: f64 = s[..end].parse().map_err(|_| format!("bad number: {}", &s[..end]))?;
        Ok((Value::Number(num), &s[end..]))
    }
    fn parse_array(s: &str) -> Result<(Value, &str), String> {
        let mut s = &s[1..]; // skip [
        let mut arr = vec![];
        s = s.trim_start();
        if s.starts_with(']') { return Ok((Value::Array(arr), &s[1..])); }
        loop {
            let (val, rest) = parse_value(s)?;
            arr.push(val);
            s = rest.trim_start();
            if s.starts_with(']') { return Ok((Value::Array(arr), &s[1..])); }
            if s.starts_with(',') { s = &s[1..]; } else { return Err("expected , or ]".into()); }
        }
    }
    fn parse_object(s: &str) -> Result<(Value, &str), String> {
        let mut s = &s[1..]; // skip {
        let mut map = HashMap::new();
        s = s.trim_start();
        if s.starts_with('}') { return Ok((Value::Object(map), &s[1..])); }
        loop {
            let (key_val, rest) = parse_string(s.trim_start())?;
            let key = if let Value::Str(k) = key_val { k } else { return Err("key not string".into()); };
            let rest = rest.trim_start();
            if !rest.starts_with(':') { return Err("expected :".into()); }
            let (val, rest) = parse_value(&rest[1..])?;
            map.insert(key, val);
            s = rest.trim_start();
            if s.starts_with('}') { return Ok((Value::Object(map), &s[1..])); }
            if s.starts_with(',') { s = &s[1..]; } else { return Err("expected , or }".into()); }
        }
    }
}

// ---- String helpers (used by routes before serde_json is available) ----

/// Extract a string field value from a raw JSON string (simple, no full parse needed)
fn json_str_field(json: &str, field: &str) -> String {
    let needle = format!("\"{field}\":");
    if let Some(start) = json.find(&needle) {
        let after = json[start + needle.len()..].trim_start();
        if after.starts_with('"') {
            let inner = &after[1..];
            let end = inner.find(|c| c == '"').unwrap_or(inner.len());
            return inner[..end]
                .replace("\\n", "\n").replace("\\r", "\r")
                .replace("\\t", "\t").replace("\\\"", "\"").replace("\\\\", "\\");
        }
    }
    String::new()
}

fn json_bool_field(json: &str, field: &str) -> bool {
    let needle = format!("\"{field}\":");
    if let Some(start) = json.find(&needle) {
        let after = json[start + needle.len()..].trim_start();
        return after.starts_with("true");
    }
    false
}

fn serde_escape_json_string(s: &str) -> String {
    format!("\"{}\"",
        s.replace('\\', "\\\\").replace('"', "\\\"")
         .replace('\n', "\\n").replace('\r', "\\r").replace('\t', "\\t")
    )
}

fn parse_query(query: &str) -> HashMap<String, String> {
    query.split('&')
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            Some((url_decode(k), url_decode(v)))
        })
        .collect()
}

fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let h1 = chars.next().unwrap_or('0');
            let h2 = chars.next().unwrap_or('0');
            if let Ok(byte) = u8::from_str_radix(&format!("{h1}{h2}"), 16) {
                result.push(byte as char);
            }
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    result
}

/// RFC 3339 "now" without chrono crate
fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Simple ISO 8601 from unix timestamp (UTC, no DST)
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400; // days since 1970-01-01
    let (y, mo, d) = days_to_ymd(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    let mut year = 1970u64;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let days_in_year = if leap { 366 } else { 365 };
        if days < days_in_year { break; }
        days -= days_in_year;
        year += 1;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 0usize;
    for &md in &month_days {
        if days < md { break; }
        days -= md;
        month += 1;
    }
    (year, (month + 1) as u64, days + 1)
}
