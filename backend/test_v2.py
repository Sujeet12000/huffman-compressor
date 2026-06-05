from compressor import compress_file, decompress_file

stats = compress_file(
    "sample.txt",
    "compressed.bin"
)

print(stats)

stats2 = decompress_file(
    "compressed.bin",
    "decompressed.txt"
)

print(stats2)

print("Done")