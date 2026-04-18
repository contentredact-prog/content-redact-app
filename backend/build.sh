#!/usr/bin/env bash
# build.sh — Render build script for Content Redact backend

set -e

echo "=== Installing Python dependencies ==="
pip install --upgrade pip
pip install -r requirements.txt

echo "=== Downloading static fpcalc ==="
wget -qO fpcalc.tar.gz https://github.com/acoustid/chromaprint/releases/download/v1.5.1/chromaprint-fpcalc-1.5.1-linux-x86_64.tar.gz
tar -xzf fpcalc.tar.gz
mv chromaprint-fpcalc-1.5.1-linux-x86_64/fpcalc ./fpcalc
rm -rf fpcalc.tar.gz chromaprint-fpcalc-1.5.1-linux-x86_64
chmod +x fpcalc

echo "=== Downloading static ffmpeg ==="
wget -qO ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
tar -xf ffmpeg.tar.xz
mv ffmpeg-*-amd64-static/ffmpeg ./ffmpeg
rm -rf ffmpeg.tar.xz ffmpeg-*-amd64-static
chmod +x ffmpeg

echo "=== Build complete ==="