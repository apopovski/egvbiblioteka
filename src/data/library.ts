export type LanguageCode = 'sr' | 'mk' | 'hr' | 'sl';

export type Chapter = {
  id: string;
  title: string;
};

export type ChapterContent = Chapter & {
  html: string;
};

export type TranslationContent = {
  chapters: ChapterContent[];
};

export type LibrarySearchIndexEntry = {
  bookId: string;
  bookTitle: string;
  author: string;
  description: string;
  chapterId: string;
  chapterTitle: string;
  chapterOrder: number;
  text: string;
};

export type LibrarySearchIndex = {
  entries: LibrarySearchIndexEntry[];
};

export type BookTranslation = {
  language: LanguageCode;
  title: string;
  author: string;
  description: string;
  heroLines?: string[];
  chapters: Chapter[];
  contentPath: string;
};

export type Book = {
  id: string;
  accent: string;
  coverGradient: string;
  translations: BookTranslation[];
};

export type RouteState = {
  language: LanguageCode;
  bookId?: string;
  chapterId?: string;
};

import { SPISI_LIBRARY } from './spisiLibrary';

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  sr: 'Српски',
  mk: 'Македонски',
  hr: 'Hrvatski',
  sl: 'Slovenščina',
};

export const LANGUAGE_ROUTE_SEGMENTS: Record<LanguageCode, string> = {
  sr: 'sr',
  mk: 'mk',
  hr: 'hr',
  sl: 'sl',
};

export const LIBRARY: Book[] = SPISI_LIBRARY;

export function getTranslation(book: Book, language: LanguageCode): BookTranslation {
  return book.translations.find((entry) => entry.language === language) ?? book.translations[0];
}

export function getBookById(bookId: string): Book | undefined {
  return LIBRARY.find((book) => book.id === bookId);
}

export function getChapterById(book: Book, language: LanguageCode, chapterId: string) {
  return getTranslation(book, language).chapters.find((chapter) => chapter.id === chapterId);
}

function buildContentUrl(contentPath: string) {
  const normalizedPath = String(contentPath || '').replace(/^\/+/, '');
  return `${import.meta.env.BASE_URL}${normalizedPath}`;
}

const searchIndexCache = new Map<LanguageCode, Promise<LibrarySearchIndex>>();

export async function loadTranslationContent(book: Book, language: LanguageCode): Promise<TranslationContent> {
  const translation = getTranslation(book, language);
  const response = await fetch(buildContentUrl(translation.contentPath));

  if (!response.ok) {
    throw new Error(`Ne mogu da učitam sadržaj knjige (${response.status}).`);
  }

  return response.json() as Promise<TranslationContent>;
}

export async function loadLibrarySearchIndex(language: LanguageCode): Promise<LibrarySearchIndex> {
  const cached = searchIndexCache.get(language);
  if (cached) return cached;

  const request = (async () => {
    const primaryResponse = await fetch(buildContentUrl(`generated/search/${language}.json`));
    if (primaryResponse.ok) {
      return primaryResponse.json() as Promise<LibrarySearchIndex>;
    }

    if (language !== 'sr') {
      const fallbackResponse = await fetch(buildContentUrl('generated/search/sr.json'));
      if (fallbackResponse.ok) {
        return fallbackResponse.json() as Promise<LibrarySearchIndex>;
      }
    }

    throw new Error(`Ne mogu da učitam indeks pretrage (${primaryResponse.status}).`);
  })();

  searchIndexCache.set(language, request);
  return request;
}

export function buildAppPath(language: LanguageCode, bookId?: string, chapterId?: string) {
  const langSegment = LANGUAGE_ROUTE_SEGMENTS[language] || LANGUAGE_ROUTE_SEGMENTS.sr;
  const segments = ['', langSegment];

  if (bookId) {
    segments.push(bookId);
    if (chapterId) segments.push(chapterId);
  }

  return segments.join('/');
}

export function getInitialRouteState(): RouteState {
  if (typeof window === 'undefined') {
    return {
      language: 'sr',
    };
  }

  const parts = window.location.pathname.split('/').filter(Boolean);
  const [langSegment, bookSegment, chapterSegment] = parts;

  const language = (Object.entries(LANGUAGE_ROUTE_SEGMENTS).find(([, segment]) => segment === langSegment)?.[0] as LanguageCode | undefined) || 'sr';
  if (!bookSegment) {
    return {
      language,
    };
  }

  const book = getBookById(bookSegment || '');
  if (!book) {
    return {
      language,
    };
  }

  const translation = getTranslation(book, language);
  const chapter = translation.chapters.find((entry) => entry.id === chapterSegment) || translation.chapters[0];

  return {
    language,
    bookId: book.id,
    chapterId: chapter?.id,
  };
}
