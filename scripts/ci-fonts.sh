#!/bin/sh
# Font setup for rendering: Inter as the default sans-serif and system UI font,
# the same as the development environment, so golden screenshots match.
# Without it, Ubuntu falls back to whatever is installed (on the Playwright
# image, a CJK font) for system-ui, sans-serif and friends.
set -e
apt-get update
apt-get install -y --no-install-recommends fonts-inter fontconfig
cp "$(dirname "$0")/../ci/fonts/56-prefer-inter.conf" /etc/fonts/conf.d/
fc-cache -f
fc-match system-ui
fc-match sans-serif
