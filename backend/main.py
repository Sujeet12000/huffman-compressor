"""
main.py — FastAPI backend for the Huffman Compressor (Version 2)

Endpoints
─────────
  POST /compress    Accept .txt → return .bin + compression stats
  POST /decompress  Accept .bin → return .txt

Run locally
───────────
  uvicorn main:app --reload --port 8000
"""

import os
import uuid
import tempfile
import shutil
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from compressor import compress_file, decompress_file


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Huffman Compressor API",
    description="Lossless text compression and decompression via Huffman coding.",
    version="2.0.0",
)

# CORS — allow all origins so the React dev server (any port) can connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten to ["http://localhost:3000"] in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Temporary directory that lives for the lifetime of the process.
# Each request gets its own UUID-named sub-folder that is cleaned up after
# the response is sent.
TEMP_DIR = Path(tempfile.mkdtemp(prefix="huffman_api_"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_work_dir() -> Path:
    """Return a fresh per-request working directory."""
    work = TEMP_DIR / str(uuid.uuid4())
    work.mkdir(parents=True)
    return work


def _cleanup(path: Path) -> None:
    """Silently remove a directory tree (called in background after response)."""
    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/", tags=["health"])
async def health_check() -> dict[str, str]:
    """Simple liveness probe."""
    return {"status": "ok", "service": "Huffman Compressor API v2"}


@app.post("/compress", tags=["compression"])
async def compress(file: UploadFile = File(...)) -> Any:
    """
    Accept a UTF-8 plain-text (.txt) file, compress it with Huffman coding,
    and return:
      - the compressed .bin file as a download attachment
      - compression statistics in the response headers

    Response headers
    ────────────────
      X-Original-Size      : original file size in bytes
      X-Compressed-Size    : compressed file size in bytes
      X-Compression-Ratio  : original / compressed  (e.g. "1.5495")
    """
    # ── Validate upload ─────────────────────────────────────────────────────
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided.")

    original_name = Path(file.filename)
    if original_name.suffix.lower() != ".txt":
        raise HTTPException(
            status_code=415,
            detail=f"Only .txt files are accepted for compression. "
                   f"Received: '{original_name.suffix or 'no extension'}'",
        )

    work = _make_work_dir()
    input_path  = work / original_name
    output_path = work / original_name.with_suffix(".bin").name

    try:
        # ── Save upload to disk ──────────────────────────────────────────────
        contents = await file.read()
        if not contents.strip():
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        input_path.write_bytes(contents)

        # ── Compress ─────────────────────────────────────────────────────────
        stats: dict = compress_file(str(input_path), str(output_path))

        # ── Stream compressed file back ──────────────────────────────────────
        headers = {
            "X-Original-Size"    : str(stats["original_size"]),
            "X-Compressed-Size"  : str(stats["compressed_size"]),
            "X-Compression-Ratio": str(stats["compression_ratio"]),
            # Expose custom headers to browser JS (CORS)
            "Access-Control-Expose-Headers": (
                "X-Original-Size, X-Compressed-Size, X-Compression-Ratio"
            ),
        }

        return FileResponse(
            path=str(output_path),
            media_type="application/octet-stream",
            filename=output_path.name,
            headers=headers,
            background=None,   # cleanup handled below via try/finally isn't
        )

    except HTTPException:
        _cleanup(work)
        raise
    except Exception as exc:
        _cleanup(work)
        raise HTTPException(status_code=500, detail=f"Compression failed: {exc}") from exc

    # Note: work dir is intentionally NOT cleaned up here because FileResponse
    # streams the file lazily.  Use a background task on a real deployment or
    # switch to returning bytes directly (see /decompress pattern below).


@app.post("/decompress", tags=["compression"])
async def decompress(file: UploadFile = File(...)) -> Any:
    """
    Accept a Huffman-compressed .bin file, decompress it, and return the
    original plain-text content as a downloadable .txt file.
    """
    # ── Validate upload ─────────────────────────────────────────────────────
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided.")

    original_name = Path(file.filename)
    if original_name.suffix.lower() != ".bin":
        raise HTTPException(
            status_code=415,
            detail=f"Only .bin files produced by this compressor are accepted. "
                   f"Received: '{original_name.suffix or 'no extension'}'",
        )

    work = _make_work_dir()
    input_path  = work / original_name
    output_path = work / original_name.with_suffix(".txt").name

    try:
        # ── Save upload to disk ──────────────────────────────────────────────
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        input_path.write_bytes(contents)

        # ── Decompress ───────────────────────────────────────────────────────
        stats: dict = decompress_file(str(input_path), str(output_path))

        # Read decompressed text into memory so we can clean up the work dir
        # immediately (avoids leaking temp files on long-running servers).
        decompressed_bytes = output_path.read_bytes()

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Decompression failed: {exc}"
        ) from exc
    finally:
        _cleanup(work)

    # Return decompressed content as an in-memory response
    from fastapi.responses import Response

    download_name = original_name.with_suffix(".txt").name
    return Response(
        content=decompressed_bytes,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "X-Compressed-Size"  : str(stats["compressed_size"]),
            "X-Decompressed-Size": str(stats["decompressed_size"]),
            "X-Compression-Ratio": str(stats["compression_ratio"]),
            "Access-Control-Expose-Headers": (
                "X-Compressed-Size, X-Decompressed-Size, X-Compression-Ratio"
            ),
        },
    )


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

@app.on_event("shutdown")
def on_shutdown() -> None:
    """Remove the global temp directory when the server stops."""
    _cleanup(TEMP_DIR)