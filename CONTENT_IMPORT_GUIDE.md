# Content import guide

When you are ready for me to import real books into `EGVBiblioteka`, send either:

1. a filled-in `content-sources.json` file based on `content-sources.example.json`, or
2. a plain list of source file paths grouped by book and language.

## Expected per-book structure

- `id` — stable slug for routing
- `accent` — optional UI accent color
- `coverGradient` — optional hero background gradient
- `sources.sr|mk|hr|sl.title` — localized title
- `sources.sr|mk|hr|sl.author` — localized or preferred author label
- `sources.sr|mk|hr|sl.filePath` — absolute source path
- `sources.sr|mk|hr|sl.format` — one of: `txt`, `html`, `md`

## Current routing shape

The app now supports URLs in this format:

- `/{language}/{bookId}`
- `/{language}/{bookId}/{chapterId}`

Examples:

- `/sr/velika-borba`
- `/sr/velika-borba/chapter-1`
- `/hr/put-hristu/intro`

## Good next step

Send me the actual source file paths and I can replace the demo library data with real imported books.
