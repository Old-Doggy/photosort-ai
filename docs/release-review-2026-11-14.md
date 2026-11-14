# Release review — 2026-11-14

Scope: redesigned folder workspace, review queue, batch corrections and undo, similarity comparison, favorites, optional formats/models, and public-repository delivery.

## Findings resolved

| Priority | Finding | Resolution and verification |
| --- | --- | --- |
| High | Concurrent successful state updates could overwrite a favorite | Authenticated mutations reject overlapping writers with HTTP 409; cache revision prevents old projections being cached after a write. Concurrent API regression reproduced the loss before the fix and passed afterward |
| High | A mutation during final analysis could deadlock automatic shutdown | Separate inspection completion from the shutdown continuation; dedicated batch regression now completes |
| Medium | Undo ignored per-file failures returned with HTTP 200 | Retain only unrestored items, report partial failure, allow retry; browser test injects a failure before retrying successfully |
| Medium | Partial similarity-group operations could lose their undo information | Build undo from successful operations even if a later request fails; report incomplete group updates |
| Medium | Fresh checkout tests required unpublished photo fixtures | Remove the global fixture precondition; real-RAW integration tests remain optional and explicitly skipped without their fixture |
| Medium | Similarity view requested large previews for every member | Use lazy thumbnails and 12-image group pages; bound the fallback hash cache |
| Medium | Bundled fonts lacked accompanying license notices | Include upstream SIL OFL texts and font attribution |
| Low | Folder switches retained obsolete selections and undo actions | Clear folder-scoped UI state and prune unavailable selections; clamp pagination after records disappear |

## Validation

- Unit suite: 158 passed on the review machine, including optional RAW integrations
- Isolated public-source checkout: clean `npm ci`, build, lint and public-file check passed without local models or photos; 155 tests passed and the three optional real-RAW integrations skipped
- Production build and lint passed; the existing lazily loaded legacy page still produces a bundle-size warning
- Workspace browser regression passed on desktop and 390px mobile layouts, including a generated 1,005-record gallery and 125-photo similarity group
- Control API with the local CPU analyzer, output-copy deletion safety, and browser rescan checks passed
- Base assets verified: 21/21; npm official advisory audit reported zero known vulnerabilities at review time
- Public candidate-file checks exclude photos, weights, generated output and machine reports; font metadata carries upstream attribution

Generated-gallery tests validate rendering bounds, not processing throughput or recognition accuracy. Functional tests using an injected analyzer do not establish model quality. This review did not repeat GPU/NPU kernel profiling or a real VLM accuracy evaluation. HEIC depends on Windows codecs; RAW depends on Python/rawpy and camera support. Ambiguous classification and subjective recommendations still require human review.

## Release boundary

This revision is ready for ordinary local use and manual acceptance. Changes to recognition policy should use a separate evaluation round; passing engineering tests is not a claim that every photo will be classified correctly. Personal test collections, runtime state, and local evidence reports are not distributed.
