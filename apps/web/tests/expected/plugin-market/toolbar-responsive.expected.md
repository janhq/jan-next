# Discover toolbar responsive layout

- 390px: search on its own first row; index, labels, sort, and refresh wrap below it; all are contained, reachable, and separate; no horizontal overflow; search focus retained.
- 430px: search on its own first row; index, labels, sort, and refresh wrap below it; all are contained, reachable, and separate; no horizontal overflow; search focus retained.
- 768px: search on its own first row; index, labels, sort, and refresh share one row below it; all are contained, reachable, and separate; no horizontal overflow; search focus retained.
- 1280px: search on its own first row; index, labels, sort, and refresh share one row below it; all are contained, reachable, and separate; no horizontal overflow; search focus retained.

At 390px, restoring the previous no-wrap layout causes horizontal overflow and fails the same layout check. Removing that override restores the controls and preserves search focus.
