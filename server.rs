//! ChronoFlow — static file server
//! stdlib only, no external crates, single-threaded (desktop single-user).
//!
//! Build:  rustc server.rs -o server        (macOS / Linux)
//!         rustc server.rs -o server.exe    (Windows)
//! Run:    ./server          (default port 3000)
//!         ./server 8080     (custom port)
//! Then open: http://localhost:3000

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

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
// Parse the first line of an HTTP request → URL path
// ---------------------------------------------------------------------------
fn parse_request(stream: &TcpStream) -> Option<String> {
    let mut reader = BufReader::new(stream);
    let mut first_line = String::new();
    reader.read_line(&mut first_line).ok()?;
    // "GET /path HTTP/1.1"
    let mut parts = first_line.split_whitespace();
    parts.next();                      // skip method
    let path = parts.next()?.to_owned();
    Some(path)
}

// ---------------------------------------------------------------------------
// Resolve URL path → safe filesystem path (blocks path traversal)
// ---------------------------------------------------------------------------
fn resolve_path(root: &Path, url_path: &str) -> Option<PathBuf> {
    // strip query string
    let url_path = url_path.split('?').next().unwrap_or("/");

    let decoded = percent_decode(url_path);
    let rel = decoded.trim_start_matches('/');

    let candidate = if rel.is_empty() {
        root.join("index.html")
    } else {
        root.join(rel)
    };

    // canonicalize prevents ../../ traversal
    let canonical   = candidate.canonicalize().ok()?;
    let root_canon  = root.canonicalize().ok()?;
    if !canonical.starts_with(&root_canon) {
        return None;
    }

    // directory → serve its index.html
    if canonical.is_dir() {
        let index = canonical.join("index.html");
        if index.exists() { Some(index) } else { None }
    } else {
        Some(canonical)
    }
}

// ---------------------------------------------------------------------------
// Minimal %XX decoder
// ---------------------------------------------------------------------------
fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(char::from(h << 4 | l));
                i += 3;
                continue;
            }
        }
        out.push(char::from(bytes[i]));
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
// Write HTTP response
// ---------------------------------------------------------------------------
fn respond(mut stream: TcpStream, status: u16, reason: &str, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Cache-Control: no-cache\r\n\
         Access-Control-Allow-Origin: *\r\n\
         \r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

fn respond_404(stream: TcpStream, path: &str) {
    let body = format!(
        "<!doctype html><title>404</title>\
         <style>body{{font-family:monospace;background:#070a12;color:#eef1ff;\
         display:grid;place-items:center;min-height:100vh;margin:0}}</style>\
         <h1>404 &mdash; Not Found</h1><p><code>{}</code></p>\
         <p><a href='/' style='color:#74f0d3'>&larr; Home</a></p>",
        path
    );
    respond(stream, 404, "Not Found", "text/html; charset=utf-8", body.as_bytes());
}

// ---------------------------------------------------------------------------
// Handle one connection (runs on the main thread — single-user desktop app)
// ---------------------------------------------------------------------------
fn handle(stream: TcpStream, root: &Path) {
    let url_path = match parse_request(&stream) {
        Some(p) => p,
        None    => return,
    };

    match resolve_path(root, &url_path) {
        Some(file_path) => {
            match fs::read(&file_path) {
                Ok(bytes) => {
                    let ext = file_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("");
                    println!("  200  {}", url_path);
                    respond(stream, 200, "OK", mime(ext), &bytes);
                }
                Err(_) => {
                    println!("  500  {}", url_path);
                    respond(stream, 500, "Internal Server Error",
                            "text/plain", b"500 Internal Server Error");
                }
            }
        }
        None => {
            println!("  404  {}", url_path);
            respond_404(stream, &url_path);
        }
    }
}

// ---------------------------------------------------------------------------
// main — single-threaded accept loop
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
        .unwrap_or_else(|e| {
            eprintln!("Cannot bind {}: {}", addr, e);
            std::process::exit(1);
        });

    println!("\n  ✓ ChronoFlow server running");
    println!("  → http://localhost:{}", port);
    println!("  Serving: {}", root.display());
    println!("  Press Ctrl+C to stop\n");

    // Single-threaded: handle each request sequentially on the main thread.
    // This is perfectly fine for a local single-user desktop app.
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => handle(stream, &root),
            Err(e)     => eprintln!("Connection error: {}", e),
        }
    }
}
