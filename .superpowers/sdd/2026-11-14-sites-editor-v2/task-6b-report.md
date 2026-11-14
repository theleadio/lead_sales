# Task 6b report: inline text + drag and drop

## Built
- `lib/sites/richclient.ts`: client-safe sanitiser/serialiser (b i u s a br, strong->b, em->i, strike/del->s, https/mailto/tel/# links, chips `data-key` -> `{{key}}`, Google Docs `<b font-weight:normal>` ignored, scripts/styles/comments dropped, block tags -> `<br>`). Works on any DOM-shaped tree, so it is unit-tested DOM-free with plain objects.
- `lib/sites/dnd.ts`: pure `dropTarget(page, popupId, kind, fromId, hoveredId, y, rectOf)` -> `{target, line, label} | null`. Uses `validTarget(kind, target, page)`; index counted before removal; own position (same parent, index == from or from+1) returns null (no line, no dispatch).
- `v2/DragDrop.ts`: `beginDrag` (pointer events, 5px threshold, pointer capture, ghost, coloured labelled drop line, stage auto-scroll that recomputes the target while scrolling, Esc cancel in parent and iframe, click suppression after drag, dims dragged node).
- `v2/InlineText.tsx`: contenteditable on the `.t` node, toolbar in parent overlay (B I U S, link prompt, custom value menu, Done). Starts from raw `text` with chips; one `update` on Done/Esc/outside pointerdown/unmount; paste intercepted and sanitised; drop into editable blocked; Enter inserts `<br>`.
- Wiring: `EditorRoot` (dragStart in `chrome`, tile pointerdown on `.main`, `dragEnv`, `onText`), `Canvas` (dblclick starts edit for headline/sub/para/icon-text; chrome hidden while editing), CSS in editor.css / canvas-css.ts (touch-action none only on handles and tiles).
- Carry-over: editor page uses `crmScheduleCached`.

## Notes / concerns
- Font role select omitted: the prototype's select toggles headline/content font (`props.font`), which is not in the tree model, and element type change is disallowed.
- `typing()` already covers the iframe editable (duck-typed `closest` on `[contenteditable="true"]`); Delete/Ctrl+Z/Esc return early. InlineText stops Esc propagation itself.
- Word paste: bold/italic carried only by `<span style>` is lost (text kept). Server sanitises again on save.
- Dropping the first section on a completely empty page via drag is not supported (no node to hover); the "+ Add section" button covers it.
- Not browser-verified. Highest risk: execCommand insertHTML keeping chip attributes, pointer capture on flyout tiles, window.prompt selection restore.

## Verification
- tests/sites-editor-dnd.test.ts: 12 pass. Full `npm test`: 382 tests, 380 pass; failures = known stripe-webhook-db cancelled enrolment and flaky "publish and unpublish are audited". tsc clean, eslint on editor folder + new lib files clean (pre-existing `any` errors in lib/sites/runtime-dom.ts are untouched), `npm run build` passes.
