# QR Photo to Vector

A static browser app that:

- uploads a photo from a file picker
- extracts QR code content from the image
- regenerates a clean vector QR code
- lets you reformat colors, quiet zone, shape, and size
- exports SVG and PNG output

## Run locally

From this folder:

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

## Deploy

This repository includes a GitHub Pages workflow that deploys the static site automatically from the `main` branch.
