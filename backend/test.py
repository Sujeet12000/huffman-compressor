from collections import Counter
from huffman import *

text = "hello world"

freq = Counter(text)

heap = build_heap(freq)

root = build_huffman_tree(heap)

codes = generate_codes(root)

encoded_text = encode_text(text, codes)

decoded_text = decode_text(encoded_text, root)

print("Original :", text)
print("Decoded  :", decoded_text)
print("Match    :", text == decoded_text)
padded = pad_encoded_text(encoded_text)

print("Original bits:", len(encoded_text))
print("Padded bits:", len(padded))
print(padded)
padded = pad_encoded_text(encoded_text)

byte_array = get_byte_array(padded)

print(byte_array)
print("Bytes:", len(byte_array))
write_compressed_file("compressed.bin", byte_array)

print("Compressed file created!")