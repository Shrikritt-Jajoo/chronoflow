//! ChronoFlow — static file server
//! stdlib only, no external crates.
//!
//! Build:  rustc server.rs -o server
//! Run:    ./server          (default port 3000)
//!         ./server 8080     (custom port)
//! Then open: http://localhost:3000

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::thread;

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
// Parse the request line
// ---------------------------------------------------------------------------
fn parse_request(stream: &TcpStream) -> Option<String> {
    let mut reader = BufReader::new(stream);
    let mut first_line = String::new();
    reader.read_line(&mut first_line).ok()?;
    // "GET /path HTTP/1.1"
    let mut parts = first_line.split_whitespace();
    parts.next(); // method
    let path = parts.next()?.to_owned();
    Some(path)
}

// ---------------------------------------------------------------------------
// Resolve a URL path to a safe filesystem path under `root`
// Blocks path traversal (../../etc)
// ---------------------------------------------------------------------------
fn resolve_path(root: &Path, url_path: &str) -> Option<PathBuf> {
    // strip query string
    let url_path = url_path.split('?').next().unwrap_or("/");

    // decode %XX sequences
    let decoded = percent_decode(url_path);

    let rel = decoded.trim_start_matches('/');

    // build candidate
    let candidate = if rel.is_empty() {
        root.join("index.html")
    } else {
        root.join(rel)
    };

    // canonicalize to prevent traversal
    let canonical = candidate.canonicalize().ok()?;
    let root_canon = root.canonicalize().ok()?;
    if !canonical.starts_with(&root_canon) {
        return None; // traversal attempt
    }

    // if directory, serve index.html inside it
    if canonical.is_dir() {
        let index = canonical.join("index.html");
        if index.exists() { Some(index) } else { None }
    } else {
        Some(canonical)
    }
}

// ---------------------------------------------------------------------------
// Minimal percent-decoder
// ---------------------------------------------------------------------------
fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i+1]), hex_val(bytes[i+2])) {
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
         <style>body{{font-family:monospace;background:#070a12;color:#eef1ff;display:grid;place-items:center;min-height:100vh;margin:0}}</style>\
         <h1>404 &mdash; Not Found</h1><p><code>{}</code></p>\
         <p><a href='/' style='color:#74f0d3'>&larr; Home</a></p>",
        path
    );
    respond(stream, 404, "Not Found", "text/html; charset=utf-8", body.as_bytes());
}

// ---------------------------------------------------------------------------
// Handle one connection
// ---------------------------------------------------------------------------
fn handle(stream: TcpStream, root: PathBuf) {
    let url_path = match parse_request(&stream) {
        Some(p) => p,
        None    => return,
    };

    match resolve_path(&root, &url_path) {
        Some(file_path) => {
            match fs::read(&file_path) {
                Ok(bytes) => {
                    let ext = file_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("");
                    let ct = mime(ext);
                    println!("  200  {}", url_path);
                    respond(stream, 200, "OK", ct, &bytes);
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
// main
// ---------------------------------------------------------------------------
fn main() {
    // port from first CLI arg, default 3000
    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);

    // serve from the directory that contains server.rs / the binary
    // i.e. the project root where index.html lives
    let root = std::env::current_dir()
        .expect("Cannot determine current directory");

    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr)
        .unwrap_or_else(|e| { eprintln!("Cannot bind {}: {}", addr, e); std::process::exit(1); });

    println!("\n  ✓ ChronoFlow server running");
    println!("  → http://localhost:{}", port);
    println!("  Serving: {}", root.display());
    println!("  Press Ctrl+C to stop\n");

    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let root = root.clone();
                thread::spawn(move || handle(stream, root));
            }
            Err(e) => eprintln!("Connection error: {}", e),
        }
    }
}
