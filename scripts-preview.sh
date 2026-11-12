#!/bin/bash
# anteprima nel browser per collaudo: build + fixture + server statico
cd "$(dirname "$0")"
npx vite build >/dev/null && mkdir -p dist/fixtures && cp test/fixtures/*.pdf dist/fixtures/ && exec npx vite preview --port 5199 --strictPort
