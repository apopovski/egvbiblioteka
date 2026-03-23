import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd(), 'Spisi');
const MANIFEST_OUTPUT = path.resolve(process.cwd(), 'src/data/spisiLibrary.ts');
const CONTENT_OUTPUT_DIR = path.resolve(process.cwd(), 'public/generated/spisi');
const SEARCH_INDEX_OUTPUT_DIR = path.resolve(process.cwd(), 'public/generated/search');
const SUPPORTED_LANGUAGES = new Set(['sr', 'mk', 'hr', 'sl']);

const ACCENTS = ['#d6aa55', '#7dc2ff', '#a78bfa', '#34d399', '#fb7185', '#f59e0b', '#22c55e', '#06b6d4', '#e879f9', '#f97316'];
const GRADIENTS = [
  'linear-gradient(160deg, #0d1828 0%, #14253d 48%, #243851 100%)',
  'linear-gradient(160deg, #0d1d2c 0%, #123149 42%, #1c5578 100%)',
  'linear-gradient(160deg, #1a1330 0%, #2b1d49 45%, #44306d 100%)',
  'linear-gradient(160deg, #10261d 0%, #1a4738 48%, #236452 100%)',
  'linear-gradient(160deg, #2d1420 0%, #4f1f35 45%, #6d3150 100%)',
];

function slugify(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'book';
}

function stripTags(input) {
  return String(input || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeHtmlFragment(input) {
  return String(input || '')
    .replace(/<span[^>]*epub:type="pagebreak"[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/\sdir="ltr"/gi, '')
    .replace(/\s+xmlns(:\w+)?="[^"]*"/gi, '')
    .replace(/\s+epub:[^=]+="[^"]*"/gi, '')
    .replace(/\s+lang="en"/gi, '')
    .replace(/\s+xml:lang="en"/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function removeLeadingChapterHeading(input) {
  return String(input || '').replace(
    /(<div[^>]*class="chapter"[^>]*>\s*)(<h[12][^>]*class="(?:chapterhead|sectionhead)"[^>]*>[\s\S]*?<\/h[12]>\s*)/i,
    '$1',
  );
}

function createUniqueId(baseId, usedIds) {
  const normalizedBaseId = baseId || 'chapter';

  if (!usedIds.has(normalizedBaseId)) {
    usedIds.add(normalizedBaseId);
    return normalizedBaseId;
  }

  let counter = 2;
  let candidate = `${normalizedBaseId}-${counter}`;
  while (usedIds.has(candidate)) {
    counter += 1;
    candidate = `${normalizedBaseId}-${counter}`;
  }

  usedIds.add(candidate);
  return candidate;
}

function extractLanguageFromFileName(fileName) {
  const match = fileName.match(/^chapter_\d+_([a-z]{2})\.html$/i);
  return match?.[1]?.toLowerCase() || null;
}

async function listBookDirs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];

  const hasChapters = entries.some((entry) => {
    if (!entry.isFile()) return false;
    const language = extractLanguageFromFileName(entry.name);
    return Boolean(language && SUPPORTED_LANGUAGES.has(language));
  });

  if (hasChapters) {
    results.push(dir);
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...(await listBookDirs(path.join(dir, entry.name))));
    }
  }

  return results;
}

async function loadFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

function extractBody(html) {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (match?.[1] || '').trim();
}

function extractTitlePageMeta(files) {
  for (const html of files) {
    if (!/id="titlepage"/i.test(html)) continue;
    const title = stripTags(html.match(/<h1[^>]*class="sectionhead"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
    const author = stripTags(html.match(/<h5[^>]*class="sectionhead"[^>]*>([\s\S]*?)<\/h5>/i)?.[1] || '');
    if (title) return { title, author: author || 'Elen G. Vajt' };
  }
  return { title: 'Nepoznata knjiga', author: 'Elen G. Vajt' };
}

function extractChapters(files) {
  const chapters = [];
  const usedIds = new Set();
  for (const html of files) {
    const body = extractBody(html);
    if (!body) continue;
    if (/<nav[^>]+epub:type="toc"/i.test(body)) continue;
    if (/id="titlepage"/i.test(body)) continue;
    if (/id="aboutbook"/i.test(body) && /Informacije o ovoj knjizi/i.test(body)) continue;

    const title = stripTags(body.match(/<h2[^>]*class="chapterhead"[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
    if (!title) continue;

    const htmlFragment = removeLeadingChapterHeading(sanitizeHtmlFragment(body));
    chapters.push({
      id: createUniqueId(slugify(title), usedIds),
      title,
      html: htmlFragment,
    });
  }
  return chapters;
}

function relativeBookName(bookDir) {
  return path.relative(ROOT, bookDir).split(path.sep).join(' / ');
}

function getLanguageFileNames(fileNames) {
  const languageFiles = new Map();

  for (const fileName of fileNames) {
    const language = extractLanguageFromFileName(fileName);
    if (!language || !SUPPORTED_LANGUAGES.has(language)) continue;

    if (!languageFiles.has(language)) {
      languageFiles.set(language, []);
    }

    languageFiles.get(language).push(fileName);
  }

  for (const files of languageFiles.values()) {
    files.sort((a, b) => {
      const aNum = Number(a.match(/chapter_(\d+)_/i)?.[1] || '0');
      const bNum = Number(b.match(/chapter_(\d+)_/i)?.[1] || '0');
      return aNum - bNum;
    });
  }

  return languageFiles;
}

async function buildTranslation(bookDir, bookId, language, fileNames) {
  const htmlFiles = await Promise.all(fileNames.map((name) => loadFile(path.join(bookDir, name))));
  const meta = extractTitlePageMeta(htmlFiles);
  const chapters = extractChapters(htmlFiles);

  if (!chapters.length) {
    return null;
  }

  const contentRelativePath = path.posix.join('generated', 'spisi', bookId, `${language}.json`);
  const description = `${meta.title} · увезено из директоријума ${relativeBookName(bookDir)}.`;

  return {
    translation: {
      language,
      title: meta.title,
      author: meta.author,
      description,
      heroLines: [],
      contentPath: contentRelativePath,
      chapters: chapters.map(({ id, title }) => ({ id, title })),
    },
    contentRelativePath,
    content: {
      chapters,
    },
    searchEntries: chapters.map((chapter, index) => ({
      bookId,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterOrder: index,
      text: stripTags(chapter.html),
    })),
  };
}

async function buildLibrary() {
  const bookDirs = (await listBookDirs(ROOT)).sort((a, b) => relativeBookName(a).localeCompare(relativeBookName(b)));
  const books = [];
  const contentFiles = [];
  const searchIndexByLanguage = new Map();

  for (const [index, bookDir] of bookDirs.entries()) {
    const fileNames = await fs.readdir(bookDir);
    const languageFiles = getLanguageFileNames(fileNames);
    const bookId = slugify(relativeBookName(bookDir));
    const translations = [];

    for (const [language, files] of languageFiles.entries()) {
      const result = await buildTranslation(bookDir, bookId, language, files);
      if (!result) continue;

      translations.push(result.translation);
      contentFiles.push({
        path: result.contentRelativePath,
        content: result.content,
      });

      if (!searchIndexByLanguage.has(language)) {
        searchIndexByLanguage.set(language, []);
      }

      searchIndexByLanguage.get(language).push(
        ...result.searchEntries.map((entry) => ({
          ...entry,
          bookTitle: result.translation.title,
          author: result.translation.author,
          description: result.translation.description,
        })),
      );
    }

    if (!translations.length) continue;

    books.push({
      id: bookId,
      accent: ACCENTS[index % ACCENTS.length],
      coverGradient: GRADIENTS[index % GRADIENTS.length],
      translations,
    });
  }

  return { books, contentFiles, searchIndexByLanguage };
}

async function writeGeneratedContent(contentFiles) {
  await fs.rm(CONTENT_OUTPUT_DIR, { recursive: true, force: true });

  for (const entry of contentFiles) {
    const targetPath = path.resolve(process.cwd(), 'public', entry.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(entry.content), 'utf8');
  }
}

async function writeSearchIndexes(searchIndexByLanguage) {
  await fs.rm(SEARCH_INDEX_OUTPUT_DIR, { recursive: true, force: true });

  for (const [language, entries] of searchIndexByLanguage.entries()) {
    const targetPath = path.join(SEARCH_INDEX_OUTPUT_DIR, `${language}.json`);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify({ entries }), 'utf8');
  }
}

const { books, contentFiles, searchIndexByLanguage } = await buildLibrary();

await writeGeneratedContent(contentFiles);
await writeSearchIndexes(searchIndexByLanguage);

const fileText = `import type { Book } from './library';\n\nexport const SPISI_LIBRARY: Book[] = ${JSON.stringify(books, null, 2)};\n`;
await fs.mkdir(path.dirname(MANIFEST_OUTPUT), { recursive: true });
await fs.writeFile(MANIFEST_OUTPUT, fileText, 'utf8');

console.log(`Generated ${books.length} books, ${contentFiles.length} content payloads, and ${searchIndexByLanguage.size} search indexes.`);
