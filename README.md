# EGV Biblioteka

A separate Vite + React project inspired by the UI/UX of the Great Controversy reader, but designed for:

- multiple books
- Balkan languages only
- Serbian, Macedonian, Croatian, and Slovenian

## What is included

- premium reader-style hero section
- dark mode
- book selector
- language selector
- chapter navigation
- search across the active book
- shareable URLs for language, book, and chapter state
- starter multi-book data model in `src/data/library.ts`

## Routing

The app now supports route-driven navigation:

- `/{language}/{bookId}`
- `/{language}/{bookId}/{chapterId}`

Examples:

- `/sr/velika-borba`
- `/sr/velika-borba/chapter-1`
- `/hr/put-hristu/intro`

## Next step for real content

Replace the demo chapters in `src/data/library.ts` with your real books and chapters. The structure is already set up so each book can have translations in all four languages.

See also:

- `CONTENT_IMPORT_GUIDE.md`
- `content-sources.example.json`

## Run

Install dependencies and start the dev server:

- `npm install`
- `npm run dev`
