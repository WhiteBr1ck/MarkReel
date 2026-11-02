#!/usr/bin/env python3
"""Stream a local video to MarkReel without a local MCP service."""
import argparse
import http.client
import json
import os
import pathlib
import sys
import urllib.parse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, type=pathlib.Path)
    parser.add_argument("--project-id")
    parser.add_argument("--folder-id")
    parser.add_argument("--title")
    parser.add_argument("--source-media-id", help="Upload as a new version of this media")
    parser.add_argument("--mode", choices=("original", "compress"), default="original")
    parser.add_argument("--media-id", help="Reuse an existing prepared upload slot")
    parser.add_argument("--object-key", help="Original object key for that existing upload slot")
    parser.add_argument("--base-url", default=os.environ.get("MARKREEL_URL"))
    parser.add_argument("--token-env", default="MARKREEL_TOKEN")
    parser.add_argument("--timeout", type=int, default=3600)
    args = parser.parse_args()
    if not args.base_url or not os.environ.get(args.token_env):
        parser.error("Set MARKREEL_URL and the token secret environment variable")
    url = urllib.parse.urlsplit(args.base_url)
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
        parser.error("Server must be an HTTP(S) address without credentials, query or fragment")
    if bool(args.media_id) != bool(args.object_key) or (not args.media_id and not args.project_id):
        parser.error("Provide --project-id, or both --media-id and --object-key")
    file = args.file.resolve(strict=True)
    if not file.is_file() or file.stat().st_size <= 0:
        parser.error("Video must be a nonempty regular file")
    types = {"mp4": "video/mp4", "mov": "video/quicktime", "mkv": "video/x-matroska", "webm": "video/webm", "m4v": "video/x-m4v",
             "avi": "video/x-msvideo", "mts": "video/mp2t", "m2ts": "video/mp2t", "ts": "video/mp2t", "wmv": "video/x-ms-wmv",
             "flv": "video/x-flv", "mpeg": "video/mpeg", "mpg": "video/mpeg", "3gp": "video/3gpp", "3g2": "video/3gpp2"}
    mime = types.get(file.suffix.lower().lstrip("."))
    if not mime:
        parser.error("Unsupported video extension")
    base_path = url.path.rstrip("/")
    if base_path.endswith("/api"):
        base_path = base_path[:-4]
    token = os.environ[args.token_env]
    media_id, object_key, stage = args.media_id, args.object_key, "create"

    def connection():
        cls = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
        return cls(url.hostname, url.port, timeout=args.timeout)

    def request(method, route, payload=None):
        conn = connection()
        try:
            body = json.dumps(payload).encode() if payload is not None else None
            conn.request(method, base_path + "/api" + route, body=body,
                         headers={"Authorization": "Bearer " + token, **({"Content-Type": "application/json"} if body is not None else {})})
            response = conn.getresponse()
            raw = response.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                raise RuntimeError("API response exceeded 16 MB")
            try:
                data = json.loads(raw) if raw else {}
            except (ValueError, UnicodeDecodeError):
                data = {}
                if 200 <= response.status < 300:
                    raise RuntimeError(f"API returned non-JSON data (HTTP {response.status})")
            if not 200 <= response.status < 300:
                raise RuntimeError(f"API HTTP {response.status}: {data.get('error', 'request_failed')}")
            return data
        finally:
            conn.close()

    quote = lambda value: urllib.parse.quote(value, safe="")
    try:
        if not media_id:
            media_id = request("POST", "/projects/" + quote(args.project_id) + "/media",
                               {"title": args.title or file.stem[:200], **({"sourceMediaId": args.source_media_id} if args.source_media_id is not None else {}),
                                **({"folderId": args.folder_id} if args.folder_id is not None else {})})["media"]["id"]
            stage = "presign"
            object_key = request("POST", "/media/" + quote(media_id) + "/upload/presign",
                                 {"filename": file.name, "contentType": mime, "mode": args.mode})["upload"]["objectKey"]
        stage = "transfer"
        if not object_key.startswith("original/" + media_id + "/"):
            raise RuntimeError("Object key does not belong to this media")
        conn = connection()
        try:
            conn.putrequest("PUT", base_path + "/api/media/" + quote(media_id) + "/upload/file?objectKey=" + quote(object_key))
            conn.putheader("Authorization", "Bearer " + token)
            conn.putheader("Content-Type", mime)
            conn.putheader("Content-Length", str(file.stat().st_size))
            conn.endheaders()
            with file.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    conn.send(chunk)
            response = conn.getresponse()
            response.read(1024 * 1024)
            if not 200 <= response.status < 300:
                raise RuntimeError(f"Upload HTTP {response.status}")
        finally:
            conn.close()
        stage = "process"
        processing = request("POST", "/media/" + quote(media_id) + "/process", {"originalObjectKey": object_key, "mode": args.mode})
        print(json.dumps({"mediaId": media_id, "originalObjectKey": object_key, "processing": processing}))
    except Exception as error:
        # Preserve identity after uncertain network failures; retrying creation could duplicate a video.
        print(json.dumps({"error": str(error).replace(token, "[redacted]"), "recovery": {"mediaId": media_id, "originalObjectKey": object_key, "stage": stage}}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
