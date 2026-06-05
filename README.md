# HuffPress - Huffman File Compressor

A full-stack Huffman Coding based file compression and decompression tool.

## Features
- Compress .txt files into .bin format
- Decompress .bin files back into original text
- FastAPI backend
- React + Vite frontend
- Drag & Drop file upload
- Compression statistics dashboard

## Tech Stack
- Python
- FastAPI
- React
- Vite
- JavaScript

## How it Works
This project implements the Huffman Coding algorithm to generate optimal prefix-free binary codes based on character frequency.

## Screenshots

### Homepage

![Homepage](homepage.png)

### Compression & Decompression Demo

![Working Demo](working-demo.png)

## Run Locally

Backend:
```bash
cd backend
pip install -r requirement.txt
python -m uvicorn main:app --reload

