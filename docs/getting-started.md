# Getting started on Windows

## First installation

1. Install [Node.js](https://nodejs.org/) LTS, version 22.12 or newer
2. Download this repository as a ZIP and extract it, or clone it with Git
3. Open the extracted folder and double-click `首次安装.cmd`
4. Wait for npm dependencies, Chromium, base model assets, the build, and the environment check to finish
5. Choose `N` at the optional vision-model prompt if you want to start with basic classification only

The setup needs an internet connection the first time. If a download is interrupted, run the script again; verified files are skipped.

## Start LensSort

Double-click `启动网页控制.cmd` from the project folder and keep the command window open. The script opens the local page. If it does not, open the address printed in the window, normally `http://127.0.0.1:4317`.

Do not open `index.html` directly. The browser page uses the local service for folder selection, progress, previews, and safe output operations.

## Sort a folder

1. Click **编辑设置** in the run-configuration card and select a source folder and a separate output folder
2. Leave the device on automatic selection for the first run
3. Choose Basic analysis unless you have installed a local vision model
4. Click **开始分类**
5. Wait for **分类完成，已自动停止**

Each batch handles the files present when it starts. New files added later wait for the next click. The app copies results into category folders and leaves the source photos unchanged.

## Review and correct

Use the category tabs to browse. Click **查看详情** for a larger preview and the image explanation. Use **修改分类** when a result is wrong; only the output copy is moved. **删除分类副本** removes the output copy after confirmation and keeps the source photo.

After changing files in File Explorer, click **刷新** so the page reflects the current disk state.

Star photos to collect them in **收藏**; the default sort places favorites first. The list shows 60 photos per page, with 30 and 120 available in the footer. Search by filename or explanation, or change the sort order.

Select cards for batch correction. The Undo button is offered for 10 seconds; if restoration fails, remaining items stay available for retry. **待确认** opens a review queue with number keys 1–8, arrow navigation, and F to favorite. **相似组** compares candidate matches using paginated thumbnails. **导出清单** downloads a CSV classification list, not photo files or private absolute paths.

**辅助推荐** is optional. It is a technical shortlist for review, not a promise that the selected photos match your personal taste.

## Optional formats and scene semantics

HEIC/HEIF decoding needs the Windows HEIF/HEVC codecs. For RAW files, install Python 3.11 or newer and run `npm run setup:raw`. Use the same Python interpreter for setup and runtime; set `LENSSORT_RAW_PYTHON` to its full path if necessary. Camera support depends on LibRaw. Output copies preserve the original bytes.

`npm run setup:semantic` downloads roughly 400 MB of SigLIP2 assets. Auto mode uses them when installed and otherwise uses CLIP. This optional scene signal does not guarantee improvement in every category; inspect complex photos manually.

## Optional local image explanations

Run `安装本地视觉模型.cmd` to install Ollama when needed and download `qwen3.5:4b`. The model is several gigabytes and is intentionally not included in GitHub.

Other supported choices can be prepared from PowerShell:

```powershell
npm run setup:vision -- --model=gemma3:4b
npm run setup:vision -- --model=qwen3.5:9b
```

The page shows the installation state and resource advice. Basic classification still works when Ollama or a vision model is unavailable.

## Stop and update

When you are done, press **Ctrl+C** in the LensSort command window. Closing the browser tab alone does not stop the local service. LensSort does not need Windows startup registration.

For a Git checkout, back up local changes, run `git pull --ff-only`, and run `首次安装.cmd` again. For a ZIP installation, extract the new version to a new folder and select your photo folders again. Keep photo folders and results outside the project directory when possible.

If something goes wrong, see [`troubleshooting.md`](troubleshooting.md) or [`troubleshooting.zh-CN.md`](troubleshooting.zh-CN.md).
