import heapq
from collections import Counter

def build_frequency_table(text):
    return dict(Counter(text))

def build_heap(freq):
    heap = []

    for char, frequency in freq.items():
        node = HuffmanNode(char, frequency)
        heapq.heappush(heap, node)

    return heap
import heapq

def build_huffman_tree(heap):

    while len(heap) > 1:

        left = heapq.heappop(heap)
        right = heapq.heappop(heap)

        merged = HuffmanNode(None,
                             left.freq + right.freq)

        merged.left = left
        merged.right = right

        heapq.heappush(heap, merged)

    return heap[0]
def generate_codes(root):

    codes = {}

    def dfs(node, current_code):

        if node is None:
            return

        # Leaf node
        if node.char is not None:
            codes[node.char] = current_code
            return

        dfs(node.left, current_code + "0")
        dfs(node.right, current_code + "1")

    dfs(root, "")

    return codes
def encode_text(text, codes):

    encoded_text = ""

    for char in text:
        encoded_text += codes[char]

    return encoded_text
def decode_text(encoded_text, root):

    decoded = ""

    current = root

    for bit in encoded_text:

        if bit == "0":
            current = current.left
        else:
            current = current.right

        # leaf node
        if current.char is not None:
            decoded += current.char
            current = root

    return decoded

def pad_encoded_text(encoded_text):

    extra_padding = 8 - (len(encoded_text) % 8)

    if extra_padding == 8:
        extra_padding = 0

    encoded_text += "0" * extra_padding

    padded_info = format(extra_padding, "08b")

    return padded_info + encoded_text

def get_byte_array(padded_encoded_text):

    if len(padded_encoded_text) % 8 != 0:
        raise ValueError("Encoded text not padded properly")

    byte_array = bytearray()

    for i in range(0, len(padded_encoded_text), 8):

        byte = padded_encoded_text[i:i+8]

        byte_array.append(int(byte, 2))

    return byte_array
def write_compressed_file(filename, byte_array):

    with open(filename, "wb") as file:
        file.write(bytes(byte_array))

class HuffmanNode:
    def __init__(self, char, freq):
        self.char = char
        self.freq = freq
        self.left = None
        self.right = None

    def __lt__(self, other):
        return self.freq < other.freq