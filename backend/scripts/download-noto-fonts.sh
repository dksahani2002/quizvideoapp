#!/usr/bin/env bash
# Download Noto fonts used by src/utils/quizFonts.ts for non-Latin quiz text in FFmpeg drawtext.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/fonts"
mkdir -p "$OUT"

NOTO_MAIN="https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf"
NOTO_CJK="https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF"

fetch() {
  local url="$1" dest="$2"
  echo "Fetching $(basename "$dest")..."
  curl -fsSL "$url" -o "$dest"
}

fetch "$NOTO_MAIN/NotoSans/NotoSans-Bold.ttf" "$OUT/NotoSans-Bold.ttf"
fetch "$NOTO_MAIN/NotoSansDevanagari/NotoSansDevanagari-Bold.ttf" "$OUT/NotoSansDevanagari-Bold.ttf"
fetch "$NOTO_MAIN/NotoSansBengali/NotoSansBengali-Bold.ttf" "$OUT/NotoSansBengali-Bold.ttf"
fetch "$NOTO_MAIN/NotoSansTamil/NotoSansTamil-Bold.ttf" "$OUT/NotoSansTamil-Bold.ttf"
fetch "$NOTO_MAIN/NotoSansTelugu/NotoSansTelugu-Bold.ttf" "$OUT/NotoSansTelugu-Bold.ttf"
fetch "$NOTO_MAIN/NotoSansGujarati/NotoSansGujarati-Bold.ttf" "$OUT/NotoSansGujarati-Bold.ttf"
fetch "$NOTO_MAIN/NotoSansKannada/NotoSansKannada-Bold.ttf" "$OUT/NotoSansKannada-Bold.ttf"
fetch "$NOTO_MAIN/NotoSansMalayalam/NotoSansMalayalam-Bold.ttf" "$OUT/NotoSansMalayalam-Bold.ttf"
fetch "$NOTO_MAIN/NotoSansGurmukhi/NotoSansGurmukhi-Bold.ttf" "$OUT/NotoSansGurmukhi-Bold.ttf"
fetch "$NOTO_MAIN/NotoSansArabic/NotoSansArabic-Bold.ttf" "$OUT/NotoSansArabic-Bold.ttf"
fetch "$NOTO_MAIN/NotoSansThai/NotoSansThai-Bold.ttf" "$OUT/NotoSansThai-Bold.ttf"

fetch "$NOTO_CJK/SimplifiedChinese/NotoSansCJKsc-Bold.otf" "$OUT/NotoSansCJKsc-Bold.otf"
fetch "$NOTO_CJK/Japanese/NotoSansCJKjp-Bold.otf" "$OUT/NotoSansCJKjp-Bold.otf"
fetch "$NOTO_CJK/Korean/NotoSansCJKkr-Bold.otf" "$OUT/NotoSansCJKkr-Bold.otf"

echo "Done. Fonts installed under $OUT"
