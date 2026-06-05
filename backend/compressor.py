"""
compressor.py — Production-style Huffman file compressor (Version 2)

Binary file format (.bin)
─────────────────────────
 [ 4 bytes  ] metadata length  (big-endian uint32)
 [ N bytes  ] UTF-8 JSON metadata
 [ M bytes  ] compressed payload (padded Huffman bitstream)

JSON metadata schema
────────────────────
{
    "version"   : 2,
    "frequency" : { "<char>": <count>, … },
    "original_size": <bytes>
}

Public API
──────────
  compress_file(input_path, output_path)   → dict of statistics
  decompress_file(input_path, output_path) → dict of statistics
"""

import json
import os
import struct

from huffman import (
    HuffmanNode,
    build_frequency_table,
    build_heap,
    build_huffman_tree,
    generate_codes,
    encode_text,
    decode_text,
    pad_encoded_text,
    get_byte_array,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _rebuild_tree_from_frequency(frequency: dict[str, int]) -> HuffmanNode:
    """Re-create a Huffman tree from a frequency table (used during decompress)."""
    heap = build_heap(frequency)
    return build_huffman_tree(heap)


def _make_metadata(frequency: dict[str, int], original_size: int) -> bytes:
    """Serialise metadata to UTF-8 JSON bytes."""
    meta = {
        "version"      : 2,
        "frequency"    : frequency,
        "original_size": original_size,
    }
    return json.dumps(meta, ensure_ascii=False).encode("utf-8")


def _parse_metadata(raw: bytes) -> dict:
    """Deserialise metadata from UTF-8 JSON bytes."""
    return json.loads(raw.decode("utf-8"))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compress_file(input_path: str, output_path: str) -> dict:
    """
    Compress a text file using Huffman coding and write the result to output_path.

    The output file embeds a JSON frequency-table header so the file is
    fully self-contained — decompression never needs the original source.

    Args:
        input_path:  path to the plain-text file to compress
        output_path: path for the compressed .bin output file

    Returns:
        A dict with compression statistics::

            {
                "original_size"   : <int>,   # bytes
                "compressed_size" : <int>,   # bytes
                "compression_ratio": <float> # original / compressed
            }

    Raises:
        FileNotFoundError: if input_path does not exist.
        ValueError:        if the input file is empty.
    """
    # ── 1. Read input ──────────────────────────────────────────────────────
    if not os.path.isfile(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path!r}")

    with open(input_path, "r", encoding="utf-8") as fh:
        text = fh.read()

    if not text:
        raise ValueError("Input file is empty — nothing to compress.")

    original_size = os.path.getsize(input_path)  # raw bytes on disk

    # ── 2. Build Huffman tree and code table ────────────────────────────────
    frequency = build_frequency_table(text)
    heap      = build_heap(frequency)
    root      = build_huffman_tree(heap)
    codes     = generate_codes(root)

    # ── 3. Encode text → padded binary string → bytearray ──────────────────
    encoded_bits  = encode_text(text, codes)
    padded_bits   = pad_encoded_text(encoded_bits)
    payload_bytes = get_byte_array(padded_bits)

    # ── 4. Serialise metadata ───────────────────────────────────────────────
    meta_bytes  = _make_metadata(frequency, original_size)
    meta_length = len(meta_bytes)

    # ── 5. Write output file ────────────────────────────────────────────────
    #   Format: [4-byte uint32 meta_length][meta JSON][payload bytes]
    with open(output_path, "wb") as fh:
        fh.write(struct.pack(">I", meta_length))   # big-endian 4-byte length
        fh.write(meta_bytes)
        fh.write(payload_bytes)

    compressed_size = os.path.getsize(output_path)

    return {
        "original_size"   : original_size,
        "compressed_size" : compressed_size,
        "compression_ratio": round(original_size / compressed_size, 4),
    }


def decompress_file(input_path: str, output_path: str) -> dict:
    """
    Decompress a .bin file produced by compress_file().

    Reads the embedded frequency-table metadata, rebuilds the Huffman tree,
    and decodes the bitstream — no external frequency table required.

    Args:
        input_path:  path to the compressed .bin file
        output_path: path for the decompressed plain-text output file

    Returns:
        A dict with decompression statistics::

            {
                "compressed_size"   : <int>,   # bytes
                "decompressed_size" : <int>,   # bytes
                "compression_ratio" : <float>  # decompressed / compressed
            }

    Raises:
        FileNotFoundError: if input_path does not exist.
        ValueError:        if the file format is invalid or version mismatch.
    """
    # ── 1. Read compressed file ─────────────────────────────────────────────
    if not os.path.isfile(input_path):
        raise FileNotFoundError(f"Compressed file not found: {input_path!r}")

    with open(input_path, "rb") as fh:
        # Read 4-byte metadata length header
        header = fh.read(4)
        if len(header) < 4:
            raise ValueError("File too short — not a valid compressed file.")

        meta_length = struct.unpack(">I", header)[0]

        # Read metadata JSON
        meta_raw = fh.read(meta_length)
        if len(meta_raw) < meta_length:
            raise ValueError("Truncated metadata — file may be corrupt.")

        # Read compressed payload
        payload_bytes = fh.read()

    compressed_size = os.path.getsize(input_path)

    # ── 2. Parse metadata ───────────────────────────────────────────────────
    metadata = _parse_metadata(meta_raw)

    if metadata.get("version") != 2:
        raise ValueError(
            f"Unsupported file version: {metadata.get('version')}. Expected 2."
        )

    # JSON keys are always strings; values are ints — correct types already
    frequency: dict[str, int] = metadata["frequency"]

    # ── 3. Rebuild Huffman tree from stored frequency table ─────────────────
    root = _rebuild_tree_from_frequency(frequency)

    # ── 4. Convert bytearray back to padded binary string ───────────────────
    bit_string = "".join(f"{byte:08b}" for byte in payload_bytes)

    # Strip the padding prefix (first 8 bits = number of padding bits appended)
    padding_length = int(bit_string[:8], 2)
    # Remove header byte, then remove trailing padding zeros
    if padding_length > 0:
        encoded_bits = bit_string[8:-padding_length]
    else:
        encoded_bits = bit_string[8:]

    # ── 5. Decode bits → original text ─────────────────────────────────────
    decoded_text = decode_text(encoded_bits, root)

    # ── 6. Write decompressed output ────────────────────────────────────────
    with open(output_path, "w", encoding="utf-8") as fh:
        fh.write(decoded_text)

    decompressed_size = os.path.getsize(output_path)

    return {
        "compressed_size"  : compressed_size,
        "decompressed_size": decompressed_size,
        "compression_ratio": round(decompressed_size / compressed_size, 4),
    }


# ---------------------------------------------------------------------------
# Quick CLI demo  (python compressor.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    import tempfile

    # Create a sample text file for demonstration
    sample_text = (
        "Huffman coding is a lossless data compression algorithm. "
        "It assigns shorter codes to more frequent characters and "
        "longer codes to less frequent ones, minimising the total "
        "number of bits required to represent the original data.\n"
        * 10  # repeat to get a meaningful compression ratio
    )

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, encoding="utf-8"
    ) as tmp_in:
        tmp_in.write(sample_text)
        input_path = tmp_in.name

    compressed_path   = input_path.replace(".txt", "_compressed.bin")
    decompressed_path = input_path.replace(".txt", "_decompressed.txt")

    print("=== Huffman Compressor v2 ===\n")

    # Compress
    stats = compress_file(input_path, compressed_path)
    print("Compression stats:")
    print(f"  Original size   : {stats['original_size']:>10,} bytes")
    print(f"  Compressed size : {stats['compressed_size']:>10,} bytes")
    print(f"  Compression ratio: {stats['compression_ratio']:.4f}×\n")

    # Decompress
    stats2 = decompress_file(compressed_path, decompressed_path)
    print("Decompression stats:")
    print(f"  Compressed size   : {stats2['compressed_size']:>10,} bytes")
    print(f"  Decompressed size : {stats2['decompressed_size']:>10,} bytes")
    print(f"  Compression ratio : {stats2['compression_ratio']:.4f}×\n")

    # Verify round-trip fidelity
    with open(decompressed_path, "r", encoding="utf-8") as fh:
        recovered = fh.read()

    if recovered == sample_text:
        print("✓ Round-trip verification passed — decompressed text matches original.")
    else:
        print("✗ Round-trip FAILED — mismatch detected!", file=sys.stderr)

    # Clean up temp files
    for path in (input_path, compressed_path, decompressed_path):
        os.unlink(path)