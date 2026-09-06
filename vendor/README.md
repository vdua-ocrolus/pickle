# Vendored code

## qrcode.js

QR Code Generator for JavaScript by Kazuhiko Arase — https://github.com/kazuhikoarase/qrcode-generator
MIT licensed (see the header of the file). Version 2.0.4, `dist/qrcode.js` with
`dist/qrcode_UTF8.js` appended so non-ASCII player names encode correctly.

Vendored rather than loaded from a CDN because the app has to work with no
internet: every file it needs is served from the same origin and precached by
`sw.js`. Do not replace this with a CDN `<script>` tag — that would break
offline use.
