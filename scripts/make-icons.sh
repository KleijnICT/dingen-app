#!/bin/sh
# Genereert de PNG-iconen van de PWA (vereist ImageMagick). De vorm is dezelfde als
# apps/web/public/icon.svg: een afgevinkt vakje in wit op de accentkleur. We tekenen met
# ImageMagick zelf, want de ingebouwde SVG-renderer slaat lijnen over.
set -e
cd "$(dirname "$0")/../apps/web/public"
BLUE='#2f7de1'

# glyph <schaal in procenten> <uitvoer>: vakje en vinkje op een doorzichtig vlak van 1024 px.
glyph() {
  magick -size 1024x1024 xc:none -fill none -stroke white \
    -strokewidth "$(echo "56 * $1 / 100" | bc -l)" \
    -draw "translate 512,512 scale $(echo "$1 / 100" | bc -l),$(echo "$1 / 100" | bc -l) translate -512,-512 roundrectangle 272,272 752,752 112,112" \
    -strokewidth "$(echo "60 * $1 / 100" | bc -l)" \
    -draw "stroke-linecap round stroke-linejoin round translate 512,512 scale $(echo "$1 / 100" | bc -l),$(echo "$1 / 100" | bc -l) translate -512,-512 polyline 400,524 480,604 640,412" \
    "$2"
}

glyph 100 /tmp/dingen-glyph.png
magick -size 1024x1024 xc:none -fill "$BLUE" -draw "roundrectangle 0,0 1023,1023 224,224" /tmp/dingen-tile.png
magick /tmp/dingen-tile.png /tmp/dingen-glyph.png -composite /tmp/dingen-icon.png
magick /tmp/dingen-icon.png -resize 192x192 icon-192.png
magick /tmp/dingen-icon.png -resize 512x512 icon-512.png

glyph 70 /tmp/dingen-glyph.png
magick -size 1024x1024 "xc:$BLUE" /tmp/dingen-glyph.png -composite /tmp/dingen-maskable.png
magick /tmp/dingen-maskable.png -resize 512x512 icon-maskable-512.png
magick /tmp/dingen-maskable.png -resize 180x180 apple-touch-icon.png
