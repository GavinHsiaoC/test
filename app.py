import argparse
import json
import mimetypes
import posixpath
import socket
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from ai_gateway import AIGatewayClient, AIProviderError


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
CLIENT = AIGatewayClient()


def to_jsonable(value: Any, *, max_depth: int = 6, _seen: set[int] | None = None) -> Any:
    if _seen is None:
        _seen = set()
    if value is None or isinstance(value, (str, int, float, bool)):
        if isinstance(value, str) and len(value) > 4000:
            return value[:4000] + "...[truncated]"
        return value
    if max_depth <= 0:
        return repr(value)

    value_id = id(value)
    if value_id in _seen:
        return f"[Circular reference: {type(value).__name__}]"
    _seen.add(value_id)

    next_depth = max_depth - 1
    if isinstance(value, dict):
        return {str(key): to_jsonable(item, max_depth=next_depth, _seen=_seen) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(item, max_depth=next_depth, _seen=_seen) for item in value]
    if hasattr(value, "model_dump"):
        try:
            return to_jsonable(value.model_dump(mode="json"), max_depth=next_depth, _seen=_seen)
        except Exception:
            try:
                return to_jsonable(value.model_dump(mode="python"), max_depth=next_depth, _seen=_seen)
            except Exception:
                return repr(value)
    if hasattr(value, "dict"):
        try:
            return to_jsonable(value.dict(), max_depth=next_depth, _seen=_seen)
        except Exception:
            return repr(value)
    if hasattr(value, "__dict__"):
        try:
            return to_jsonable(vars(value), max_depth=next_depth, _seen=_seen)
        except TypeError:
            return repr(value)
    return repr(value)


def compact_config(config: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in config.items():
        if value in ("", None):
            continue
        if isinstance(value, dict) and not value:
            continue
        cleaned[key] = value
    return cleaned


def build_error_payload(exc: Exception) -> tuple[int, dict[str, Any]]:
    if isinstance(exc, AIProviderError):
        error = exc.error
        return (
            error.http_status or HTTPStatus.BAD_GATEWAY,
            {
                "ok": False,
                "error": {
                    "code": error.code,
                    "message": error.message,
                    "provider": error.provider,
                    "http_status": error.http_status,
                    "error_type": error.error_type,
                    "metadata": to_jsonable(error.metadata),
                    "raw": to_jsonable(error.raw),
                },
            },
        )
    return (
        HTTPStatus.INTERNAL_SERVER_ERROR,
        {
            "ok": False,
            "error": {
                "code": "internal_server_error",
                "message": str(exc) or "Unexpected server error",
            },
        },
    )


class ChatHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.serve_file(STATIC_DIR / "index.html")
            return
        if parsed.path == "/api/health":
            self.send_json({"ok": True, "service": "llm-sdk-chat-tester"})
            return
        if parsed.path.startswith("/static/"):
            relative_path = parsed.path.removeprefix("/static/")
            safe_path = posixpath.normpath(relative_path).lstrip("/")
            file_path = STATIC_DIR / safe_path
            if STATIC_DIR not in file_path.resolve().parents and file_path.resolve() != STATIC_DIR.resolve():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self.serve_file(file_path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/chat":
            self.handle_chat(stream=False)
            return
        if parsed.path == "/api/chat/stream":
            self.handle_chat(stream=True)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_chat(self, stream: bool) -> None:
        try:
            payload = self.read_json_body()
            config = compact_config(dict(payload.get("config") or {}))
            messages = payload.get("messages") or []

            if not isinstance(messages, list) or not messages:
                raise ValueError("messages must be a non-empty list")
            if not config.get("provider"):
                raise ValueError("config.provider is required")
            if not config.get("model"):
                raise ValueError("config.model is required")

            if stream:
                self.stream_chat(config, messages)
                return

            response = CLIENT.chat(config, messages)
            self.send_json(
                {
                    "ok": True,
                    "response": to_jsonable(response),
                }
            )
        except ValueError as exc:
            self.send_json(
                {
                    "ok": False,
                    "error": {
                        "code": "invalid_request_error",
                        "message": str(exc),
                    },
                },
                status=HTTPStatus.BAD_REQUEST,
            )
        except Exception as exc:
            status, body = build_error_payload(exc)
            self.send_json(body, status=status)

    def stream_chat(self, config: dict[str, Any], messages: list[dict[str, Any]]) -> None:
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True

        content_parts: list[str] = []
        last_chunk: Any = None

        try:
            for chunk in CLIENT.stream_chat(config, messages):
                last_chunk = chunk
                delta = chunk.content_delta or ""
                if delta:
                    content_parts.append(delta)
                self.write_stream_line(
                    {
                        "type": "delta",
                        "delta": delta,
                        "id": chunk.id,
                        "provider": chunk.provider,
                        "model": chunk.model,
                        "finish_reason": chunk.finish_reason,
                        "is_done": chunk.is_done,
                    }
                )

            self.write_stream_line(
                {
                    "type": "done",
                    "content": "".join(content_parts),
                    "chunk": to_jsonable(last_chunk),
                }
            )
        except Exception as exc:
            _, body = build_error_payload(exc)
            self.write_stream_line(
                {
                    "type": "error",
                    "error": body["error"],
                }
            )

    def read_json_body(self) -> dict[str, Any]:
        content_length = self.headers.get("Content-Length")
        if not content_length:
            raise ValueError("Missing request body")
        body = self.rfile.read(int(content_length))
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON body: {exc.msg}") from exc

    def serve_file(self, file_path: Path) -> None:
        if not file_path.exists() or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        mime_type, _ = mimetypes.guess_type(file_path.name)
        data = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{mime_type or 'application/octet-stream'}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def write_stream_line(self, payload: dict[str, Any]) -> None:
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        self.wfile.write(line.encode("utf-8"))
        self.wfile.flush()

    def log_message(self, format: str, *args: Any) -> None:
        message = "%s - - [%s] %s\n" % (
            self.address_string(),
            self.log_date_time_string(),
            format % args,
        )
        print(message, end="")


def main() -> None:
    parser = argparse.ArgumentParser(description="LLM SDK chat tester")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    with ThreadingHTTPServer((args.host, args.port), ChatHandler) as server:
        print(f"Serving on http://{args.host}:{args.port}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped")


if __name__ == "__main__":
    main()
