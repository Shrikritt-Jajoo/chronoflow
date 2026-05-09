# ChronoFlow — Local Server

A zero-dependency Rust static file server so Gmail OAuth works on `localhost`.

## Requirements
- [Rust](https://rustup.rs/) installed (`rustc` in PATH)

## Build & Run

```bash
# 1. Clone / download the repo, cd into it
cd chronoflow

# 2. Compile (one-time, ~1 second)
rustc server.rs -o server        # macOS / Linux
rustc server.rs -o server.exe    # Windows

# 3. Start server (default port 3000)
./server

# or pick a custom port
./server 8080
```

Then open **http://localhost:3000** in your browser.

## What it does
| Feature | Detail |
|---|---|
| Serves all files | HTML, CSS, JS, fonts, images |
| Correct MIME types | All common web types handled |
| Path traversal blocked | Cannot escape the project folder |
| Directory index | `/` and any folder → `index.html` |
| CORS header | `Access-Control-Allow-Origin: *` |
| Threaded | Each request in its own thread |
| No cache | `Cache-Control: no-cache` for dev |

## Why Rust + stdlib only?
`server.rs` uses **zero external crates** — just `std`. No `cargo`, no `Cargo.toml`, no `node_modules`. Compile with a single `rustc` command.

## File structure expected
```
chronoflow/
├── server.rs        ← compile this
├── index.html
├── planner.html
├── focus.html
├── stats.html
├── settings.html
├── css/
└── js/
```
