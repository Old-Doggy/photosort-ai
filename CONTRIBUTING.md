# Contributing to LensSort AI

Thanks for helping improve LensSort AI.

## Before you start

- Read the English or [Chinese README](README.zh-CN.md).
- Open an issue first for large behavior changes or new model integrations.
- Keep pull requests focused and easy to review.

## Local development

```powershell
npm ci
npm run doctor
npm run test:all
npm run build
npm run lint
```

The application is developed and tested primarily on Windows because folder access, GPU discovery, and Windows ML/NPU support are part of the product scope.

`test:all` runs without model downloads or personal photos. The three real-RAW integration tests skip when the optional local fixture `data/eval/raw/sample.orf` is absent. To run them, prepare a licensed RAW sample at that location and install Python dependencies with `npm run setup:raw`; do not commit the image. Windows HEIC integration also requires the system HEIF/HEVC codecs.

After building, `npm run verify:workspace` checks the main browser flows in Microsoft Edge with generated images and an isolated test analyzer. It covers interaction and file handling, not model accuracy or GPU/NPU execution.

Bundled interface fonts carry their own [SIL OFL notices](src/assets/fonts/README.md).

## Change boundaries

- Never commit personal photos, model weights, generated output, cache files, credentials, or machine-specific paths.
- Preserve the source-folder safety rule: classification and correction may copy or move output copies, but must not modify source photos.
- Keep uncertain visual results reviewable instead of turning weak evidence into a definite label.
- Do not describe simulated, proxy, or CPU-assisted NPU evidence as pure NPU inference.
- Add or update focused tests when changing classification, model lifecycle, folder writes, or privacy boundaries.

## Pull requests

Please include:

1. What changed and why.
2. Tests and commands that passed.
3. Any hardware, model, license, or privacy limitation.
4. A note confirming that no private files or model binaries are included.

Use a descriptive commit style such as `feat:`, `fix:`, `docs:`, `test:`, or `chore:`.
