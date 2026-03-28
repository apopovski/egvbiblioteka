import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { MdArrowBack, MdDarkMode, MdLightMode, MdMenuBook, MdOutlinePushPin, MdOutlineStar, MdPushPin, MdSearch, MdStar } from 'react-icons/md';
import './App.css';
import './BookReader.css';
import {
  buildAppPath,
  getInitialRouteState,
  getTranslation,
  LANGUAGE_LABELS,
  LIBRARY,
  loadLibrarySearchIndex,
  loadTranslationContent,
  type Book,
  type Chapter,
  type ChapterContent,
  type LanguageCode,
  type LibrarySearchIndexEntry,
} from './data/library';
import { useDarkMode } from './utils/useDarkMode';

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function estimateReadingStats(html: string) {
  const text = stripTags(html);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 190));

  return { wordCount, readingMinutes };
}

function createSearchSnippet(text: string, query: string) {
  const normalizedText = String(text || '');
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return normalizedText.slice(0, 180);

  const hitIndex = normalizedText.toLowerCase().indexOf(normalizedQuery);
  if (hitIndex === -1) return normalizedText.slice(0, 180);

  const start = Math.max(0, hitIndex - 70);
  const end = Math.min(normalizedText.length, hitIndex + normalizedQuery.length + 110);
  const snippet = normalizedText.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${snippet}${end < normalizedText.length ? '…' : ''}`;
}

function getHighlightedParts(text: string, query: string) {
  const source = String(text || '');
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [{ text: source, match: false }];
  }

  const lowerSource = source.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];

  let cursor = 0;
  while (cursor < source.length) {
    const hitIndex = lowerSource.indexOf(lowerQuery, cursor);
    if (hitIndex === -1) {
      parts.push({ text: source.slice(cursor), match: false });
      break;
    }

    if (hitIndex > cursor) {
      parts.push({ text: source.slice(cursor, hitIndex), match: false });
    }

    parts.push({ text: source.slice(hitIndex, hitIndex + normalizedQuery.length), match: true });
    cursor = hitIndex + normalizedQuery.length;
  }

  return parts.filter((part) => part.text.length > 0);
}

function scoreTextMatch(text: string, query: string) {
  const source = String(text || '').trim().toLowerCase();
  const needle = query.trim().toLowerCase();

  if (!source || !needle) return 0;
  if (source === needle) return 140;
  if (source.startsWith(needle)) return 100;

  const boundaryPattern = new RegExp(`(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu');
  if (boundaryPattern.test(source)) return 72;
  if (source.includes(needle)) return 46;

  return 0;
}

type SearchMatch = {
  idx: number;
  title: string;
  snippet: string;
};

type SavedReadingState = {
  language: LanguageCode;
  bookId: string;
  chapterId?: string;
};

type RecentReadingState = SavedReadingState & {
  updatedAt: number;
};

type LibraryFilter = 'all' | 'favorites' | 'continue' | 'recent' | 'short' | 'deep';
type LibrarySort = 'featured' | 'title' | 'shortest' | 'longest';

type CuratedCollection = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  bookIds: string[];
};

type RecommendationBlock = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  books: Book[];
};

type SearchActionResult = {
  id: string;
  type: 'chapter' | 'book';
  label: string;
  bookId: string;
  chapterIndex: number;
};

type VisitorInsight = {
  totalVisitors: number | null;
  country: string | null;
};

function dedupeBooks(books: Book[]) {
  const seen = new Set<string>();
  return books.filter((book) => {
    if (seen.has(book.id)) return false;
    seen.add(book.id);
    return true;
  });
}

const LAST_READING_KEY = 'egv-last-reading';
const LIBRARY_SCROLL_KEY = 'egv-library-scroll-y';
const FAVORITE_BOOKS_KEY = 'egv-favorite-books';
const RECENT_BOOKS_KEY = 'egv-recent-books';
const RECENT_SEARCH_QUERIES_KEY = 'egv-recent-search-queries';
const PINNED_SEARCH_QUERIES_KEY = 'egv-pinned-search-queries';
const TOPIC_PATH_COMPLETIONS_KEY = 'egv-topic-path-completions';
const READER_TEXT_SCALE_KEY = 'egv-reader-text-scale';
const LOCKED_LANGUAGE: LanguageCode = 'sr';

const LIBRARY_FILTERS: Array<{ id: LibraryFilter; label: string }> = [
  { id: 'all', label: 'Sve knjige' },
  { id: 'favorites', label: 'Omiljene' },
  { id: 'continue', label: 'Nastavi čitanje' },
  { id: 'recent', label: 'Nedavno otvorene' },
  { id: 'short', label: 'Kraće knjige' },
  { id: 'deep', label: 'Dubinsko čitanje' },
];

const LIBRARY_SORTS: Array<{ id: LibrarySort; label: string }> = [
  { id: 'featured', label: 'Istaknuto' },
  { id: 'title', label: 'Naslov A–Š' },
  { id: 'shortest', label: 'Najkraće prvo' },
  { id: 'longest', label: 'Najduže prvo' },
];

const CURATED_COLLECTIONS: CuratedCollection[] = [
  {
    id: 'prorocanstvo-i-sukob',
    eyebrow: 'Tematska celina',
    title: 'Proročanstvo i veliki sukob',
    description: 'Naslovi za čitaoce koji žele liniju svetilišta, suda, velike borbe i istorijskog toka događaja.',
    bookIds: ['hrist-u-svojoj-svetinji', 'konfrontacija', 'prica-o-iskupljenju', 'nebo'],
  },
  {
    id: 'duhovni-zivot',
    eyebrow: 'Život vere',
    title: 'Vera, posvećenje i svakodnevni hod',
    description: 'Knjige za praktičan duhovni život, rast karaktera, posvećenje i odnos vere i dela.',
    bookIds: ['vera-i-dela', 'posvecen-zivot', 'umerenost', 'zivotne-skice-iz-pavlovog-zivota'],
  },
  {
    id: 'crkveni-saveti',
    eyebrow: 'Saveti crkvi',
    title: 'Poruke, svedočanstva i usmerenje crkvi',
    description: 'Uredni ulaz u izbor poruka i svedočanstava za šire proučavanje crkvenog iskustva i misije.',
    bookIds: ['odabrane-poruke-1', 'odabrane-poruke-2', 'odabrane-poruke-3', 'svedocanstva-za-crkvu-svedocanstva-za-crkvu-1'],
  },
];

const DAILY_DEVOTIONAL = {
  label: 'Dnevno razmišljanje',
  title: 'Prebivalište za Duha',
  source: 'Revju i Herald (Review and Herald), 31. decembar 1908',
  paragraphs: [
    'Hristos je predstavljen kao Onaj koji svojim Duhom prebiva u svom narodu, a vernici su opisani kao oni „koji su nazidani na temelju apostola i proroka, gde je sam Isus Hristos ugaoni kamen; u kome se sva građevina skladno sastavlja i raste u sveti hram u Gospodu; u kome se i vi zajedno ugrađujete za prebivalište Božje u Duhu“ (Efescima 2:20–22). „Ja dakle, sužanj Gospoda,“ kaže Pavle, „molim vas da živite dostojno zvanja kojim ste pozvani, sa svakom poniznošću i krotkošću, sa dugotrpljenjem, podnoseći jedni druge u ljubavi, trudeći se da održite jedinstvo Duha u svezi mira. Jedno je telo i jedan Duh, kao što ste pozvani u jednoj nadi svoga zvanja; jedan Gospod, jedna vera, jedno krštenje, jedan Bog i Otac svih, koji je nad svima, kroz sve i u svima vama“ (Efescima 4:1–6).',
    'Od večnih vekova bila je Božja namera da svako stvoreno biće, od svetlog i svetog serafima do čoveka, bude hram za prebivanje Stvoritelja. Zbog greha, čovečanstvo je prestalo da bude hram Božji. Pomračeno i uprljano zlom, srce čoveka više nije odražavalo slavu Božju. Ali utelovljenjem Sina Božjeg, nebeska namera se ispunjava. Bog prebiva u čovečanstvu, i kroz spasonosnu blagodat srce čoveka ponovo postaje Njegov hram.',
    'Bog je odredio da hram u Jerusalimu bude stalni svedok uzvišene sudbine otvorene svakoj duši. Ali Jevreji nisu razumeli značaj građevine na koju su gledali sa tolikim ponosom. Oni se nisu predali kao hramovi Božjeg Duha. Dvorišta hrama u Jerusalimu, ispunjena metežom nesvete trgovine, verno su prikazivala hram srca, uprljan prisustvom čulnih strasti i nesvetih misli. Čisteći hram od kupaca i prodavaca, Isus je objavio svoju misiju da očisti srce od prljavštine greha — od zemaljskih želja, sebičnih požuda i zlih navika koje kvare dušu. „Gospod, koga tražite, iznenada će doći u svoj hram, anđeo zaveta koga vi želite; gle, dolazi, veli Gospod nad vojskama. Ko će podneti dan njegovog dolaska? i ko će opstati kad se pojavi? jer je on kao oganj topioničarski i kao sapun beliočev; i sešće kao topioničar i čistač srebra, i očistiće sinove Levijeve i pretopiće ih kao zlato i srebro“ (Malahija 3:1–3).',
    '„Ili ne znate da ste vi hram Božji i da Duh Božji prebiva u vama? Ako ko pokvari hram Božji, pokvariće njega Bog; jer je hram Božji svet, a to ste vi“ (1. Korinćanima 3:16–17). Nijedan čovek sam ne može izbaciti zlo koje je zauzelo srce. Samo Hristos može očistiti hram duše. Ali On neće silom ući. On ne dolazi u srce kao u hram nekada; nego kaže: „Evo stojim na vratima i kucam; ako ko čuje moj glas i otvori vrata, ući ću k njemu“ (Otkrivenje 3:20). On dolazi ne samo na jedan dan; jer kaže: „Useliću se u njih, i hodiću u njima; i oni će biti moj narod“ (Levitski 26:12). Njegovo prisustvo očistiće i posvetiti dušu, tako da postane sveti hram Gospodu i „prebivalište Božje u Duhu“.',
    'Ovom slikom Božja Reč pokazuje koliko ceni naš fizički organizam i koliku odgovornost imamo da ga sačuvamo u najboljem stanju. Naša tela su Hristova kupljena svojina, i nemamo slobodu da činimo s njima šta želimo. Čovek je postupao drugačije. Njegovim izopačenim apetitom organi i moći su oslabili, oboleli i osakaćeni. Sotona koristi ove posledice svojih lukavih iskušenja da bi vređao Boga. Predstavlja pred Bogom ljudsko telo koje je Hristos kupio kao svoju svojinu; i kakva ružna slika čoveka, stvorenog na sliku Božju! Zato što je čovek zgrešio protiv svog tela i pokvario svoje puteve, Bog se obeščašćuje.',
    'Kada su ljudi istinski obraćeni, oni savesno poštuju zakone života koje je Bog postavio u njihovo biće, nastojeći da izbegnu telesnu, mentalnu i moralnu slabost. Poslušnost ovim zakonima mora postati lična dužnost. Mi sami snosimo posledice kršenja zakona. Odgovorni smo pred Bogom za svoje navike i postupke. Zato pitanje nije: „Šta će svet reći?“ nego: „Kako ću ja, koji se nazivam hrišćaninom, postupati prema prebivalištu koje mi je Bog dao? Hoću li raditi za svoje najveće dobro, telesno i duhovno, čuvajući telo kao hram za prebivanje Svetoga Duha, ili ću se pokoriti idejama i običajima sveta?“',
    '„Ili ne znate da niste svoji? Jer ste kupljeni cenom“ (1. Korinćanima 6:19–20). Kakva cena je plaćena za nas! Pogledajte krst i žrtvu uzdignutu na njemu. Pogledajte ruke probodene okrutnim klinovima. Pogledajte noge prikovane za drvo. Hristos je poneo naše grehe u svom telu. Ta patnja i agonija predstavljaju cenu našeg otkupljenja. Ne znate li da nas je voleo i dao sebe za nas, da bismo mi zauzvrat dali sebe Njemu? Zašto ljubav prema Hristu ne bi bila iskazana od svih koji Ga primaju verom, isto tako stvarno kao što je Njegova ljubav pokazana prema nama za koje je umro?',
    '„Drugog temelja niko ne može postaviti osim onoga koji je postavljen, a to je Isus Hristos“ (1. Korinćanima 3:11). „Nema drugog imena pod nebom danoga ljudima kojim bismo se mogli spasti“ (Dela apostolska 4:12). Hristos, Reč Božja, otkrivenje Njegovog karaktera, zakona, ljubavi i života, jedini je temelj na kome možemo graditi trajni karakter.',
    'Mi gradimo na Hristu poslušnošću Njegovoj Reči. Pravedan nije onaj koji samo uživa u pravednosti, nego onaj koji čini pravednost. Svetost nije ushićenje; ona je rezultat potpunog predanja Bogu, vršenja volje nebeskog Oca. Religija se sastoji u vršenju Hristovih reči, ne da bismo zaslužili Božju naklonost, nego zato što smo primili dar Njegove ljubavi. Hristos ne zasniva spasenje samo na ispovedanju, već na veri koja se pokazuje delima pravednosti. „Koje vodi Duh Božji, oni su sinovi Božji“ (Rimljanima 8:14). Ne oni čija su srca povremeno dotaknuta Duhom, već oni koji su vođeni Duhom, jesu sinovi Božji.',
    'Živeti po Reči Božjoj znači predati Mu ceo život. Stalno se oseća potreba i zavisnost, izvlačenje srca ka Bogu. Molitva je neophodna, jer je život duše. Porodična i javna molitva imaju svoje mesto, ali tajno zajedništvo sa Bogom održava život duše. Na gori sa Bogom, Mojsije je video uzorak divne građevine koja je trebalo da bude prebivalište Božje slave. Na gori sa Bogom — u tajnom mestu zajedništva — posmatramo Njegov slavni ideal za čovečanstvo. Tako oblikujemo karakter i gradimo hram, da se na nama ispuni Njegovo obećanje: „Useliću se u njih, i hodiću u njima; i biću njihov Bog, i oni će biti moj narod“ (Levitski 26:12).',
  ],
};

const EDITORIAL_QUICK_TOPICS = [
  'Hristos',
  'vera',
  'opravdanje',
  'svetilište',
  'posvećenje',
  'zakon',
  'proročanstvo',
  'drugi dolazak',
];

const QUICK_TOPIC_SPOTLIGHTS: Record<string, {
  title: string;
  description: string;
  bookIds: string[];
  collectionIds: string[];
  path: Array<{ label: string; bookId: string; note: string }>;
}> = {
  hristos: {
    title: 'Hristos u središtu biblioteke',
    description: 'Naslovi koji otvaraju Hristovu službu, Njegovu pravednost i Njegovo mesto u planu spasenja.',
    bookIds: ['hrist-u-svojoj-svetinji', 'vera-i-dela', 'prica-o-iskupljenju'],
    collectionIds: ['prorocanstvo-i-sukob', 'duhovni-zivot'],
    path: [
      { label: 'Počni ovde', bookId: 'prica-o-iskupljenju', note: 'Šira slika plana spasenja i Hristovog dela kroz istoriju.' },
      { label: 'Zatim', bookId: 'vera-i-dela', note: 'Kako Hristova pravednost dotiče praktičan život vere.' },
      { label: 'Idi dublje', bookId: 'hrist-u-svojoj-svetinji', note: 'Služba svetilišta i Hristovo delo u nebeskom okviru.' },
    ],
  },
  vera: {
    title: 'Tema vere i hoda sa Bogom',
    description: 'Praktična linija za čitanje o veri, poslušnosti, iskustvu obraćenja i svakodnevnom životu.',
    bookIds: ['vera-i-dela', 'posvecen-zivot', 'zivotne-skice-iz-pavlovog-zivota'],
    collectionIds: ['duhovni-zivot'],
    path: [
      { label: 'Počni ovde', bookId: 'vera-i-dela', note: 'Najbrži ulaz u odnos vere, dela i spasenja.' },
      { label: 'Zatim', bookId: 'posvecen-zivot', note: 'Praktičan rast karaktera i posvećenja u svakodnevici.' },
      { label: 'Idi dublje', bookId: 'zivotne-skice-iz-pavlovog-zivota', note: 'Vera u pokretu kroz život, službu i iskušenja.' },
    ],
  },
  opravdanje: {
    title: 'Pravednost, milost i opravdanje',
    description: 'Odabrani naslovi za razumevanje odnosa vere, dela, zakona i Hristove pravednosti.',
    bookIds: ['vera-i-dela', 'odabrane-poruke-1', 'odabrane-poruke-3'],
    collectionIds: ['duhovni-zivot', 'crkveni-saveti'],
    path: [
      { label: 'Počni ovde', bookId: 'vera-i-dela', note: 'Jasan početak za temu opravdanja verom.' },
      { label: 'Zatim', bookId: 'odabrane-poruke-1', note: 'Širi teološki okvir poruke o Hristovoj pravednosti.' },
      { label: 'Idi dublje', bookId: 'odabrane-poruke-3', note: 'Dalje nijanse, istorijski kontekst i primena u crkvi.' },
    ],
  },
  'svetilište': {
    title: 'Svetilište i velika borba',
    description: 'Najdirektniji ulaz u teme službe u svetilištu, suda i istorije velike borbe.',
    bookIds: ['hrist-u-svojoj-svetinji', 'konfrontacija', 'prica-o-iskupljenju'],
    collectionIds: ['prorocanstvo-i-sukob'],
    path: [
      { label: 'Počni ovde', bookId: 'hrist-u-svojoj-svetinji', note: 'Najdirektniji uvod u temu svetilišta.' },
      { label: 'Zatim', bookId: 'prica-o-iskupljenju', note: 'Poveži svetilište sa širim tokom iskupljenja.' },
      { label: 'Idi dublje', bookId: 'konfrontacija', note: 'Velika borba, sud i završni događaji u većem obimu.' },
    ],
  },
  posvećenje: {
    title: 'Posvećenje i rast karaktera',
    description: 'Kompaktan put za one koji žele praktične teme posvećenja, karaktera i reforme života.',
    bookIds: ['posvecen-zivot', 'vera-i-dela', 'umerenost'],
    collectionIds: ['duhovni-zivot'],
    path: [
      { label: 'Počni ovde', bookId: 'posvecen-zivot', note: 'Najpraktičniji uvod u temu posvećenog života.' },
      { label: 'Zatim', bookId: 'vera-i-dela', note: 'Uravnoteži iskustvo posvećenja sa pravednošću verom.' },
      { label: 'Idi dublje', bookId: 'umerenost', note: 'Prelazak na disciplinu života, navika i karaktera.' },
    ],
  },
  zakon: {
    title: 'Zakon, Jevanđelje i poslušnost',
    description: 'Naslovi koji povezuju Božji zakon, jevanđelje i pravednost kroz veru.',
    bookIds: ['odabrane-poruke-1', 'vera-i-dela', 'prica-o-iskupljenju'],
    collectionIds: ['duhovni-zivot', 'crkveni-saveti'],
    path: [
      { label: 'Počni ovde', bookId: 'vera-i-dela', note: 'Jasan most između vere, poslušnosti i milosti.' },
      { label: 'Zatim', bookId: 'odabrane-poruke-1', note: 'Dublji rad na odnosu zakona i jevanđelja.' },
      { label: 'Idi dublje', bookId: 'prica-o-iskupljenju', note: 'Posmatraj temu kroz veliku liniju biblijske istorije.' },
    ],
  },
  'proročanstvo': {
    title: 'Proročanstvo i istorijski tok',
    description: 'Za čitaoce koji žele liniju proročkih tema, istorije sukoba i završnih događaja.',
    bookIds: ['konfrontacija', 'prica-o-iskupljenju', 'nebo'],
    collectionIds: ['prorocanstvo-i-sukob'],
    path: [
      { label: 'Počni ovde', bookId: 'prica-o-iskupljenju', note: 'Pregled velikog narativa od pobune do obnove.' },
      { label: 'Zatim', bookId: 'konfrontacija', note: 'Širi fokus na veliku borbu i istorijske posledice.' },
      { label: 'Idi dublje', bookId: 'nebo', note: 'Završna nada, ishod istorije i nova zemlja.' },
    ],
  },
  'drugi dolazak': {
    title: 'Drugi dolazak i završna nada',
    description: 'Povezana čitanja o Hristovom povratku, nadi neba i završetku istorije greha.',
    bookIds: ['nebo', 'konfrontacija', 'prica-o-iskupljenju'],
    collectionIds: ['prorocanstvo-i-sukob'],
    path: [
      { label: 'Počni ovde', bookId: 'nebo', note: 'Najbrži ulaz u temu nade, povratka i večnog ishoda.' },
      { label: 'Zatim', bookId: 'prica-o-iskupljenju', note: 'Poveži završnu nadu sa celim planom iskupljenja.' },
      { label: 'Idi dublje', bookId: 'konfrontacija', note: 'Širi apokaliptički i istorijski okvir završnih događaja.' },
    ],
  },
};

function loadSavedReadingState(): SavedReadingState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(LAST_READING_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SavedReadingState;
    if (!parsed?.bookId || !parsed?.language) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLibraryScrollPosition() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LIBRARY_SCROLL_KEY, String(window.scrollY));
}

function readLibraryScrollPosition() {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(LIBRARY_SCROLL_KEY);
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function loadFavoriteBooks(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(FAVORITE_BOOKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function loadRecentBooks(): RecentReadingState[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(RECENT_BOOKS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as RecentReadingState[];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (entry): entry is RecentReadingState =>
        Boolean(entry && typeof entry.bookId === 'string' && typeof entry.language === 'string' && typeof entry.updatedAt === 'number'),
    );
  } catch {
    return [];
  }
}

function loadRecentSearchQueries(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(RECENT_SEARCH_QUERIES_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function rememberRecentSearch(current: string[], query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return current;

  const next = [
    trimmedQuery,
    ...current.filter((entry) => entry.toLowerCase() !== trimmedQuery.toLowerCase()),
  ].slice(0, 8);

  if (next.length === current.length && next.every((entry, index) => entry === current[index])) {
    return current;
  }

  return next;
}

function loadPinnedSearchQueries(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(PINNED_SEARCH_QUERIES_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

function loadTopicPathCompletions(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(TOPIC_PATH_COMPLETIONS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function buildTopicPathStepKey(topicKey: string, bookId: string, index: number) {
  return `${topicKey}::${index}::${bookId}`;
}

function rememberPinnedSearch(current: string[], query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return current;

  return [
    trimmedQuery,
    ...current.filter((entry) => entry.toLowerCase() !== trimmedQuery.toLowerCase()),
  ].slice(0, 6);
}

function loadReaderTextScale() {
  if (typeof window === 'undefined') return 1;

  const raw = Number(window.localStorage.getItem(READER_TEXT_SCALE_KEY));
  if (!Number.isFinite(raw)) return 1;

  return Math.min(1.28, Math.max(0.88, raw));
}

export default function App() {
  const initialRoute = getInitialRouteState();
  const [dark, setDark] = useDarkMode();
  const [language, setLanguage] = useState<LanguageCode>(LOCKED_LANGUAGE);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(initialRoute.bookId ?? null);
  const [chapterIndex, setChapterIndex] = useState(() => {
    if (!initialRoute.bookId) return 0;

    const book = LIBRARY.find((entry) => entry.id === initialRoute.bookId) ?? LIBRARY[0];
    const translation = getTranslation(book, LOCKED_LANGUAGE);
    const idx = translation.chapters.findIndex((chapter) => chapter.id === initialRoute.chapterId);
    return idx >= 0 ? idx : 0;
  });
  const [readerQuery, setReaderQuery] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [loadedChapters, setLoadedChapters] = useState<ChapterContent[]>([]);
  const [contentLoading, setContentLoading] = useState(Boolean(initialRoute.bookId));
  const [contentError, setContentError] = useState<string | null>(null);
  const [librarySearchIndex, setLibrarySearchIndex] = useState<LibrarySearchIndexEntry[]>([]);
  const [librarySearchLoading, setLibrarySearchLoading] = useState(false);
  const [librarySearchError, setLibrarySearchError] = useState<string | null>(null);
  const [transitionMode, setTransitionMode] = useState<'library' | 'reader'>(initialRoute.bookId ? 'reader' : 'library');
  const [openingBookId, setOpeningBookId] = useState<string | null>(null);
  const [lastReading, setLastReading] = useState<SavedReadingState | null>(() => loadSavedReadingState());
  const [favoriteBookIds, setFavoriteBookIds] = useState<string[]>(() => loadFavoriteBooks());
  const [recentBooks, setRecentBooks] = useState<RecentReadingState[]>(() => loadRecentBooks());
  const [recentSearchQueries, setRecentSearchQueries] = useState<string[]>(() => loadRecentSearchQueries());
  const [pinnedSearchQueries, setPinnedSearchQueries] = useState<string[]>(() => loadPinnedSearchQueries());
  const [completedTopicPathSteps, setCompletedTopicPathSteps] = useState<string[]>(() => loadTopicPathCompletions());
  const [readerTextScale, setReaderTextScale] = useState<number>(() => loadReaderTextScale());
  const [isDailyDevotionalOpen, setIsDailyDevotionalOpen] = useState(false);
  const [visitorInsight, setVisitorInsight] = useState<VisitorInsight>({ totalVisitors: null, country: null });
  const [chapterScrollProgress, setChapterScrollProgress] = useState(0);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [librarySort, setLibrarySort] = useState<LibrarySort>('featured');
  const [activeSearchResultId, setActiveSearchResultId] = useState<string | null>(null);
  const openBookTimerRef = useRef<number | null>(null);
  const restoreLibraryScrollRef = useRef(false);
  const searchResultRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const contentCardRef = useRef<HTMLDivElement | null>(null);

  const isLibraryHome = !selectedBookId;
  const activeBook = selectedBookId ? LIBRARY.find((book) => book.id === selectedBookId) ?? LIBRARY[0] : null;
  const featuredBook = activeBook ?? LIBRARY[0];
  const translation = useMemo(() => getTranslation(activeBook ?? featuredBook, language), [activeBook, featuredBook, language]);
  const usingFallbackTranslation = activeBook ? translation.language !== language : false;
  const activeChapterMeta = activeBook ? translation.chapters[chapterIndex] ?? translation.chapters[0] : undefined;
  const activeChapter = useMemo(
    () => {
      if (!activeBook) return undefined;
      return loadedChapters.find((chapter) => chapter.id === activeChapterMeta?.id) ?? loadedChapters[chapterIndex] ?? loadedChapters[0];
    },
    [activeChapterMeta?.id, chapterIndex, loadedChapters],
  );
  const activeChapterTitle = activeBook ? activeChapter?.title ?? activeChapterMeta?.title ?? 'Poglavlje' : 'Izaberi knjigu';
  const isReaderSearching = Boolean(!isLibraryHome && readerQuery.trim());
  const chapterProgressPercent = activeBook ? Math.round(((chapterIndex + 1) / Math.max(translation.chapters.length, 1)) * 100) : 0;
  const chapterProgressLabel = activeBook ? `Poglavlje ${chapterIndex + 1} od ${translation.chapters.length}` : 'Izaberi poglavlje';
  const previousChapter = activeBook && chapterIndex > 0 ? translation.chapters[chapterIndex - 1] : null;
  const nextChapter = activeBook && chapterIndex < translation.chapters.length - 1 ? translation.chapters[chapterIndex + 1] : null;
  const showReadingAssistant = !isLibraryHome && !isReaderSearching && chapterScrollProgress >= 0.22;
  const chapterReadingStats = useMemo(
    () => estimateReadingStats(activeChapter?.html ?? ''),
    [activeChapter?.html],
  );
  const formattedChapterWordCount = useMemo(
    () => new Intl.NumberFormat('sr-RS').format(chapterReadingStats.wordCount),
    [chapterReadingStats.wordCount],
  );

  const chapterMatches = useMemo(() => {
    if (!activeBook) return [] as SearchMatch[];

    const normalized = readerQuery.trim().toLowerCase();
    if (!normalized) return [] as SearchMatch[];

    return loadedChapters
      .map((chapter: ChapterContent, idx: number) => {
        const text = stripTags(chapter.html);
        const hit = text.toLowerCase().indexOf(normalized);
        if (hit === -1) return null;
        const snippet = text.slice(Math.max(0, hit - 60), Math.min(text.length, hit + normalized.length + 90)).trim();
        return { idx, title: chapter.title, snippet: snippet ? `…${snippet}…` : text };
      })
      .filter(Boolean) as SearchMatch[];
  }, [loadedChapters, readerQuery]);

  const heroCopy = activeBook ? translation.heroLines ?? [] : [];
  const heroTitle = isLibraryHome ? 'EGV Biblioteka' : translation.title;
  const heroDescription = isLibraryHome
    ? 'Izaberi knjigu iz kolekcije da otvoriš fokusirani čitač. Kada otvoriš naslov, ostaješ samo na toj knjizi dok se ne vratiš nazad u biblioteku.'
    : translation.description;
  const heroMeta = isLibraryHome
    ? [`${LIBRARY.length} knjiga`, LANGUAGE_LABELS[language], 'Klikni na naslov za čitanje']
    : [translation.author, `${translation.chapters.length} poglavlja`, activeChapterTitle];
  const activeBookId = activeBook?.id ?? '';
  const continueReadingBook = useMemo(() => {
    if (!lastReading?.bookId) return null;
    return LIBRARY.find((book) => book.id === lastReading.bookId) ?? null;
  }, [lastReading]);
  const continueReadingTranslation = useMemo(() => {
    if (!continueReadingBook || !lastReading) return null;
    return getTranslation(continueReadingBook, lastReading.language);
  }, [continueReadingBook, lastReading]);
  const continueReadingChapterTitle = useMemo(() => {
    if (!continueReadingTranslation || !lastReading?.chapterId) return null;
    return continueReadingTranslation.chapters.find((chapter) => chapter.id === lastReading.chapterId)?.title ?? null;
  }, [continueReadingTranslation, lastReading]);
  const nextChapterRecommendation = useMemo(() => {
    if (!continueReadingBook || !continueReadingTranslation || !lastReading?.chapterId) return null;

    const currentChapterIndex = continueReadingTranslation.chapters.findIndex((chapter) => chapter.id === lastReading.chapterId);
    if (currentChapterIndex < 0 || currentChapterIndex >= continueReadingTranslation.chapters.length - 1) {
      return null;
    }

    return {
      book: continueReadingBook,
      translation: continueReadingTranslation,
      chapterIndex: currentChapterIndex + 1,
      currentChapterTitle: continueReadingTranslation.chapters[currentChapterIndex]?.title,
      nextChapterTitle: continueReadingTranslation.chapters[currentChapterIndex + 1]?.title,
    };
  }, [continueReadingBook, continueReadingTranslation, lastReading]);
  const favoriteBooks = useMemo(() => {
    const order = new Map(favoriteBookIds.map((id, index) => [id, index]));
    return LIBRARY
      .filter((book) => order.has(book.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [favoriteBookIds]);
  const recentLibraryItems = useMemo(() => {
    return recentBooks
      .map((entry) => {
        const book = LIBRARY.find((item) => item.id === entry.bookId);
        if (!book) return null;

        const item = getTranslation(book, entry.language);
        const savedChapterIndex = item.chapters.findIndex((chapter) => chapter.id === entry.chapterId);
        const savedChapterTitle = savedChapterIndex >= 0 ? item.chapters[savedChapterIndex]?.title : item.chapters[0]?.title;

        return {
          book,
          item,
          savedChapterIndex: savedChapterIndex >= 0 ? savedChapterIndex : 0,
          savedChapterTitle,
        };
      })
      .filter(Boolean)
      .slice(0, 8) as Array<{
      book: Book;
      item: ReturnType<typeof getTranslation>;
      savedChapterIndex: number;
      savedChapterTitle?: string;
    }>;
  }, [recentBooks]);
  const activeQuickTopicKey = useMemo(() => {
    const normalized = libraryQuery.trim().toLowerCase();
    return Object.keys(QUICK_TOPIC_SPOTLIGHTS).find((key) => key === normalized) ?? null;
  }, [libraryQuery]);
  const activeTopicBookPriority = useMemo(() => {
    if (!activeQuickTopicKey) return new Map<string, number>();

    const config = QUICK_TOPIC_SPOTLIGHTS[activeQuickTopicKey];
    return new Map(config.bookIds.map((bookId, index) => [bookId, index]));
  }, [activeQuickTopicKey]);
  const filteredLibraryBooks = useMemo(() => {
    let result: Book[];

    switch (libraryFilter) {
      case 'favorites':
        result = LIBRARY.filter((book) => favoriteBookIds.includes(book.id));
        break;
      case 'continue':
        result = lastReading?.bookId ? LIBRARY.filter((book) => book.id === lastReading.bookId) : [];
        break;
      case 'recent':
        result = recentLibraryItems.map((entry) => entry.book);
        break;
      case 'short':
        result = LIBRARY.filter((book) => getTranslation(book, language).chapters.length <= 18);
        break;
      case 'deep':
        result = LIBRARY.filter((book) => getTranslation(book, language).chapters.length >= 30);
        break;
      case 'all':
      default:
        result = LIBRARY;
        break;
    }

    const sorted = [...result];

    if (activeTopicBookPriority.size) {
      sorted.sort((a, b) => {
        const aPriority = activeTopicBookPriority.has(a.id) ? activeTopicBookPriority.get(a.id)! : Number.POSITIVE_INFINITY;
        const bPriority = activeTopicBookPriority.has(b.id) ? activeTopicBookPriority.get(b.id)! : Number.POSITIVE_INFINITY;

        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }

        return 0;
      });
    }

    switch (librarySort) {
      case 'title':
        sorted.sort((a, b) => {
          const aPriority = activeTopicBookPriority.has(a.id) ? activeTopicBookPriority.get(a.id)! : Number.POSITIVE_INFINITY;
          const bPriority = activeTopicBookPriority.has(b.id) ? activeTopicBookPriority.get(b.id)! : Number.POSITIVE_INFINITY;
          if (aPriority !== bPriority) return aPriority - bPriority;
          return getTranslation(a, language).title.localeCompare(getTranslation(b, language).title, 'sr');
        });
        break;
      case 'shortest':
        sorted.sort((a, b) => {
          const aPriority = activeTopicBookPriority.has(a.id) ? activeTopicBookPriority.get(a.id)! : Number.POSITIVE_INFINITY;
          const bPriority = activeTopicBookPriority.has(b.id) ? activeTopicBookPriority.get(b.id)! : Number.POSITIVE_INFINITY;
          if (aPriority !== bPriority) return aPriority - bPriority;
          return getTranslation(a, language).chapters.length - getTranslation(b, language).chapters.length;
        });
        break;
      case 'longest':
        sorted.sort((a, b) => {
          const aPriority = activeTopicBookPriority.has(a.id) ? activeTopicBookPriority.get(a.id)! : Number.POSITIVE_INFINITY;
          const bPriority = activeTopicBookPriority.has(b.id) ? activeTopicBookPriority.get(b.id)! : Number.POSITIVE_INFINITY;
          if (aPriority !== bPriority) return aPriority - bPriority;
          return getTranslation(b, language).chapters.length - getTranslation(a, language).chapters.length;
        });
        break;
      case 'featured':
      default:
        break;
    }

    return sorted;
  }, [activeTopicBookPriority, favoriteBookIds, language, lastReading?.bookId, libraryFilter, librarySort, recentLibraryItems]);
  const curatedCollections = useMemo(() => {
    return CURATED_COLLECTIONS.map((collection) => ({
      ...collection,
      books: collection.bookIds
        .map((bookId) => LIBRARY.find((book) => book.id === bookId))
        .filter(Boolean) as Book[],
    })).filter((collection) => collection.books.length);
  }, []);
  const recommendationBlocks = useMemo(() => {
    const blocks: RecommendationBlock[] = [];
    const pushBlock = (block: RecommendationBlock) => {
      if (block.books.length) {
        blocks.push(block);
      }
    };

    const viewGuidance: Record<LibraryFilter, { eyebrow: string; title: string; description: string }> = {
      all: {
        eyebrow: 'U fokusu danas',
        title: 'Izdvojeno iz biblioteke',
        description: 'Brz urednički presek kroz naslove koji lepo otvaraju čitanje i dalje proučavanje.',
      },
      favorites: {
        eyebrow: 'Tvoja polica',
        title: 'Omiljeni naslovi na dohvat ruke',
        description: 'Pošto si već izdvojio/la ove knjige, evo najbržeg puta da im se vratiš.',
      },
      continue: {
        eyebrow: 'Bez prekida',
        title: 'Vrati se tačno tamo gde si stao/la',
        description: 'Otvorili smo fokus na onome što si već započeo/la da bi povratak bio trenutan.',
      },
      recent: {
        eyebrow: 'Sveže otvoreno',
        title: 'Tvoj nedavni tok čitanja',
        description: 'Naslovi koje si skoro pregledao/la, složeni za brz povratak u isti ritam.',
      },
      short: {
        eyebrow: 'Kraća čitanja',
        title: 'Za fokusirane i brže sesije',
        description: 'Kompaktniji naslovi kada želiš dubinu bez velikog vremenskog zaleta.',
      },
      deep: {
        eyebrow: 'Dublje proučavanje',
        title: 'Naslovi za duži studijski tok',
        description: 'Šire knjige za sporije, sistematično čitanje i povezivanje većih tema.',
      },
    };

    const viewBasedBooks = dedupeBooks(filteredLibraryBooks).slice(0, 3);
    pushBlock({
      id: 'view-based',
      ...viewGuidance[libraryFilter],
      books: viewBasedBooks,
    });

    if (continueReadingBook && continueReadingTranslation) {
      const relatedCollection = curatedCollections.find((collection) => collection.books.some((book) => book.id === continueReadingBook.id));
      const continueBooks = dedupeBooks([
        continueReadingBook,
        ...(relatedCollection?.books ?? []),
        ...recentLibraryItems.map((entry) => entry.book),
      ]).slice(0, 3);

      pushBlock({
        id: 'continue-path',
        eyebrow: 'Nastavak',
        title: 'Nastavi svoj put čitanja',
        description: continueReadingChapterTitle
          ? `Tvoje poslednje otvoreno poglavlje je „${continueReadingChapterTitle}”. Evo knjiga koje se prirodno nadovezuju.`
          : `Poslednje si otvorio/la „${continueReadingTranslation.title}”. Nastavi bez traženja gde si stao/la.`,
        books: continueBooks,
      });
    }

    if (favoriteBooks.length) {
      const favoriteAnchors = favoriteBooks.slice(0, 2).map((book) => book.id);
      const becausePinned = dedupeBooks([
        ...favoriteBooks.slice(0, 2),
        ...LIBRARY.filter((book) => !favoriteAnchors.includes(book.id) && ['odabrane-poruke-1', 'vera-i-dela', 'posvecen-zivot'].includes(book.id)),
      ]).slice(0, 3);

      pushBlock({
        id: 'favorites-path',
        eyebrow: 'Po tvojoj polici',
        title: 'Na osnovu omiljenih knjiga',
        description: 'Tvoje zvezdice već crtaju ukus — ovo su naslovi koji lepo nastavljaju isti tok proučavanja.',
        books: becausePinned,
      });
    }

    const startHere = dedupeBooks(LIBRARY.filter((book) => ['nebo', 'vera-i-dela', 'prica-o-iskupljenju'].includes(book.id))).slice(0, 3);
    const shortReads = [...LIBRARY]
      .sort((a, b) => getTranslation(a, language).chapters.length - getTranslation(b, language).chapters.length)
      .slice(0, 3);

    pushBlock({
      id: 'start-here',
      eyebrow: 'Preporuka',
      title: 'Najbolje za početak',
      description: 'Prijatan ulaz za novo čitanje, sa naslovima koji brzo uvode u glavne teme biblioteke.',
      books: startHere,
    });

    pushBlock({
      id: 'short-reads',
      eyebrow: 'Brzo čitanje',
      title: 'Za kraće sesije',
      description: 'Odabir kraćih knjiga kada želiš fokusirano čitanje bez velikog zaleta.',
      books: shortReads,
    });

    return blocks.slice(0, 3);
  }, [continueReadingBook, continueReadingChapterTitle, continueReadingTranslation, curatedCollections, favoriteBooks, filteredLibraryBooks, language, libraryFilter, recentLibraryItems]);
  const discoveryResults = useMemo(() => {
    const normalized = libraryQuery.trim().toLowerCase();
    if (!normalized) {
      return {
        books: [] as Array<{
          book: Book;
          translation: ReturnType<typeof getTranslation>;
          matchedChapter?: string;
          matchedChapterIndex?: number;
          reason: string;
          score: number;
        }>,
        chapters: [] as Array<{
          entry: LibrarySearchIndexEntry;
          book: Book;
          translation: ReturnType<typeof getTranslation>;
          chapterIndex: number;
          snippet: string;
          score: number;
        }>,
        collections: [] as Array<(typeof curatedCollections)[number] & { score: number }>,
      };
    }

    const books = LIBRARY.flatMap((book) => {
      const item = getTranslation(book, language);
      const matchedChapterIndex = item.chapters.findIndex((chapter) => chapter.title.toLowerCase().includes(normalized));
      const matchedChapter = matchedChapterIndex >= 0 ? item.chapters[matchedChapterIndex]?.title : undefined;
      const titleScore = scoreTextMatch(item.title, normalized);
      const authorScore = scoreTextMatch(item.author, normalized);
      const descriptionScore = scoreTextMatch(item.description, normalized);
      const matchedChapterScore = matchedChapter ? scoreTextMatch(matchedChapter, normalized) + 8 : 0;
      const score = Math.max(titleScore + 28, authorScore + 10, descriptionScore, matchedChapterScore);

      if (score > 0 && Math.max(titleScore, authorScore, descriptionScore) > 0) {
        return [{ book, translation: item, matchedChapter, matchedChapterIndex: matchedChapterIndex >= 0 ? matchedChapterIndex : undefined, reason: titleScore > 0 ? 'Naslov' : authorScore > 0 ? 'Autor' : 'Opis', score }];
      }

      if (matchedChapter) {
        return [{ book, translation: item, matchedChapter, matchedChapterIndex, reason: 'Poglavlje', score: matchedChapterScore }];
      }

      return [];
    })
      .sort((a, b) => b.score - a.score || a.translation.title.localeCompare(b.translation.title, 'sr'))
      .slice(0, 8);

    const chapters = librarySearchIndex.flatMap((entry) => {
      const titleScore = scoreTextMatch(entry.chapterTitle, normalized) + 14;
      const bodyScore = scoreTextMatch(entry.text, normalized);
      const score = Math.max(titleScore, bodyScore);
      if (score <= 0) return [];

      const book = LIBRARY.find((candidate) => candidate.id === entry.bookId);
      if (!book) return [];

      const item = getTranslation(book, language);
      const chapterIndex = item.chapters.findIndex((chapter) => chapter.id === entry.chapterId);
      if (chapterIndex < 0) return [];

      return [{
        entry,
        book,
        translation: item,
        chapterIndex,
        snippet: createSearchSnippet(entry.text, normalized),
        score,
      }];
    })
      .sort((a, b) => b.score - a.score || a.chapterIndex - b.chapterIndex)
      .slice(0, 8);

    const collections = curatedCollections.flatMap((collection) => {
      const bookTitles = collection.books.map((book) => getTranslation(book, language).title).join(' ');
      const score = Math.max(
        scoreTextMatch(collection.title, normalized) + 24,
        scoreTextMatch(collection.eyebrow, normalized) + 8,
        scoreTextMatch(collection.description, normalized),
        scoreTextMatch(bookTitles, normalized),
      );

      return score > 0 ? [{ ...collection, score }] : [];
    })
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'sr'));

    return { books, chapters, collections };
  }, [curatedCollections, language, libraryQuery, librarySearchIndex]);
  const groupedDiscoveryChapters = useMemo(() => {
    const groups = new Map<string, {
      book: Book;
      translation: ReturnType<typeof getTranslation>;
      hits: typeof discoveryResults.chapters;
    }>();

    for (const hit of discoveryResults.chapters) {
      const existing = groups.get(hit.book.id);
      if (existing) {
        existing.hits.push(hit);
        continue;
      }

      groups.set(hit.book.id, {
        book: hit.book,
        translation: hit.translation,
        hits: [hit],
      });
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        hits: [...group.hits].sort((a, b) => b.score - a.score || a.chapterIndex - b.chapterIndex),
        topScore: Math.max(...group.hits.map((hit) => hit.score)),
      }))
      .sort((a, b) => b.topScore - a.topScore || a.translation.title.localeCompare(b.translation.title, 'sr'));
  }, [discoveryResults.chapters]);
  const topicSpotlight = useMemo(() => {
    if (!activeQuickTopicKey) return null;

    const config = QUICK_TOPIC_SPOTLIGHTS[activeQuickTopicKey];
    if (!config) return null;

    const books = config.bookIds
      .map((bookId) => LIBRARY.find((book) => book.id === bookId))
      .filter(Boolean) as Book[];
    const collections = config.collectionIds
      .map((collectionId) => curatedCollections.find((collection) => collection.id === collectionId))
      .filter(Boolean) as typeof curatedCollections;

    return {
      key: activeQuickTopicKey,
      ...config,
      books,
      collections,
    };
  }, [activeQuickTopicKey, curatedCollections]);
  const topicPathProgress = useMemo(() => {
    if (!topicSpotlight) return null;

    const visitedBookIds = new Set(recentBooks.map((entry) => entry.bookId));
    const completedStepKeys = new Set(completedTopicPathSteps);
    if (lastReading?.bookId) {
      visitedBookIds.add(lastReading.bookId);
    }

    const steps = topicSpotlight.path.map((step, index) => {
      const completionKey = buildTopicPathStepKey(topicSpotlight.key, step.bookId, index);

      return {
        ...step,
        completionKey,
        completed: completedStepKeys.has(completionKey),
        visited: visitedBookIds.has(step.bookId),
        isCurrent: lastReading?.bookId === step.bookId,
      };
    });

    const completedCount = steps.filter((step) => step.completed).length;
    const nextStepIndex = steps.findIndex((step) => !step.completed);
    const recommendedIndex = nextStepIndex >= 0 ? nextStepIndex : -1;

    return {
      steps,
      completedCount,
      recommendedIndex,
    };
  }, [completedTopicPathSteps, lastReading?.bookId, recentBooks, topicSpotlight]);
  const hasNoDiscoveryResults = Boolean(
    libraryQuery.trim() &&
    !librarySearchLoading &&
    !librarySearchError &&
    !discoveryResults.books.length &&
    !discoveryResults.chapters.length &&
    !discoveryResults.collections.length,
  );
  const actionableSearchResults = useMemo(() => {
    const chapterResults: SearchActionResult[] = groupedDiscoveryChapters.flatMap(({ book, hits }) =>
      hits.map((hit) => ({
        id: `chapter-${book.id}-${hit.entry.chapterId}`,
        type: 'chapter',
        label: `${book.id}:${hit.entry.chapterTitle}`,
        bookId: book.id,
        chapterIndex: hit.chapterIndex,
      })),
    );

    const bookResults: SearchActionResult[] = discoveryResults.books.map(({ book, translation: item, matchedChapterIndex }) => {
      const savedChapterIndex = lastReading?.bookId === book.id
        ? item.chapters.findIndex((chapter) => chapter.id === lastReading?.chapterId)
        : -1;

      return {
        id: `book-${book.id}`,
        type: 'book',
        label: item.title,
        bookId: book.id,
        chapterIndex: matchedChapterIndex ?? (savedChapterIndex >= 0 ? savedChapterIndex : 0),
      };
    });

    return [...chapterResults, ...bookResults];
  }, [discoveryResults.books, groupedDiscoveryChapters, lastReading]);
  const isReaderTextScaleMin = readerTextScale <= 0.88;
  const isReaderTextScaleMax = readerTextScale >= 1.28;
  const readerTextScalePercent = `${Math.round(readerTextScale * 100)}%`;
  const formattedVisitorTotal = useMemo(
    () => (visitorInsight.totalVisitors !== null ? new Intl.NumberFormat('sr-RS').format(visitorInsight.totalVisitors) : null),
    [visitorInsight.totalVisitors],
  );
  const contentCardStyle = {
    '--book-accent': featuredBook.accent,
    '--reader-content-font-scale': readerTextScale,
  } as CSSProperties;

  const syncRoute = (nextLanguage: LanguageCode, nextBookId?: string | null, nextChapterIndex = 0, replace = false) => {
    if (!nextBookId) {
      document.title = 'EGV Biblioteka';
      window.history[replace ? 'replaceState' : 'pushState']({}, '', buildAppPath(nextLanguage));
      return;
    }

    const nextBook = LIBRARY.find((entry) => entry.id === nextBookId) ?? LIBRARY[0];
    const nextTranslation = getTranslation(nextBook, nextLanguage);
    const nextChapter = nextTranslation.chapters[nextChapterIndex] ?? nextTranslation.chapters[0];
    const nextPath = buildAppPath(nextLanguage, nextBook.id, nextChapter?.id);
    const nextTitle = `${nextTranslation.title} · ${nextChapter?.title || 'EGV Biblioteka'}`;

    document.title = nextTitle;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', nextPath);
  };

  const navigateTo = (nextLanguage: LanguageCode, nextBookId: string, nextChapterIndex: number, replace = false) => {
    if (openBookTimerRef.current) {
      window.clearTimeout(openBookTimerRef.current);
      openBookTimerRef.current = null;
    }

    setOpeningBookId(null);
    setLanguage(nextLanguage);
    setSelectedBookId(nextBookId);
    setChapterIndex(nextChapterIndex);
    setTransitionMode('reader');
    syncRoute(nextLanguage, nextBookId, nextChapterIndex, replace);
  };

  const navigateHome = (nextLanguage: LanguageCode, replace = false) => {
    if (openBookTimerRef.current) {
      window.clearTimeout(openBookTimerRef.current);
      openBookTimerRef.current = null;
    }

    setOpeningBookId(null);
    setLanguage(nextLanguage);
    setSelectedBookId(null);
    setChapterIndex(0);
    setReaderQuery('');
    setTransitionMode('library');
    restoreLibraryScrollRef.current = true;
    syncRoute(nextLanguage, null, 0, replace);
  };

  useEffect(() => {
    return () => {
      if (openBookTimerRef.current) {
        window.clearTimeout(openBookTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    syncRoute(language, selectedBookId, chapterIndex, true);
  }, []);

  useEffect(() => {
    if (!activeBook) {
      setLoadedChapters([]);
      setContentLoading(false);
      setContentError(null);
      return;
    }

    let cancelled = false;

    setLoadedChapters([]);
    setContentLoading(true);
    setContentError(null);

    loadTranslationContent(activeBook, language)
      .then((content) => {
        if (cancelled) return;
        setLoadedChapters(content.chapters);
        setContentLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setLoadedChapters([]);
        setContentError('Sadržaj knjige trenutno ne može da se učita.');
        setContentLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeBook, language]);

  useEffect(() => {
    if (!isLibraryHome || !libraryQuery.trim()) {
      setLibrarySearchLoading(false);
      setLibrarySearchError(null);
      return;
    }

    let cancelled = false;
    setLibrarySearchLoading(true);
    setLibrarySearchError(null);

    loadLibrarySearchIndex(language)
      .then((payload) => {
        if (cancelled) return;
        setLibrarySearchIndex(payload.entries);
        setLibrarySearchLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setLibrarySearchIndex([]);
        setLibrarySearchError('Indeks pretrage trenutno nije dostupan.');
        setLibrarySearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLibraryHome, language, libraryQuery]);

  useEffect(() => {
    if (!libraryQuery.trim() || !actionableSearchResults.length) {
      setActiveSearchResultId(null);
      return;
    }

    setActiveSearchResultId((current) => {
      if (current && actionableSearchResults.some((result) => result.id === current)) {
        return current;
      }

      return actionableSearchResults[0]?.id ?? null;
    });
  }, [actionableSearchResults, libraryQuery]);

  useEffect(() => {
    if (!activeSearchResultId) return;
    const node = searchResultRefs.current[activeSearchResultId];
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeSearchResultId]);

  useEffect(() => {
    if (!activeBook || !activeChapterMeta) return;

    const nextLastReading = {
      language,
      bookId: activeBook.id,
      chapterId: activeChapterMeta.id,
    } satisfies SavedReadingState;
    const recentEntry = {
      ...nextLastReading,
      updatedAt: Date.now(),
    } satisfies RecentReadingState;

    setLastReading(nextLastReading);
    setRecentBooks((current) => [recentEntry, ...current.filter((entry) => entry.bookId !== recentEntry.bookId)].slice(0, 8));

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LAST_READING_KEY, JSON.stringify(nextLastReading));
    }
  }, [activeBook, activeChapterMeta, language]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(FAVORITE_BOOKS_KEY, JSON.stringify(favoriteBookIds));
  }, [favoriteBookIds]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(RECENT_BOOKS_KEY, JSON.stringify(recentBooks));
  }, [recentBooks]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(RECENT_SEARCH_QUERIES_KEY, JSON.stringify(recentSearchQueries));
  }, [recentSearchQueries]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PINNED_SEARCH_QUERIES_KEY, JSON.stringify(pinnedSearchQueries));
  }, [pinnedSearchQueries]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TOPIC_PATH_COMPLETIONS_KEY, JSON.stringify(completedTopicPathSteps));
  }, [completedTopicPathSteps]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(READER_TEXT_SCALE_KEY, String(readerTextScale));
  }, [readerTextScale]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return;

    const controller = new AbortController();
    const baseUrl = String(import.meta.env.BASE_URL || '/');
    const normalizedKey = `${hostname}${baseUrl}`
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const storageKey = `egv-visitor-tracked-${normalizedKey}`;
    const alreadyTrackedToday = window.localStorage.getItem(storageKey) === today;
    const countUrl = alreadyTrackedToday
      ? `https://api.countapi.xyz/get/egv-biblioteka/${normalizedKey}`
      : `https://api.countapi.xyz/hit/egv-biblioteka/${normalizedKey}`;

    Promise.allSettled([
      fetch(countUrl, { signal: controller.signal }).then((response) => response.json() as Promise<{ value?: number }>),
      fetch('https://ipapi.co/json/', { signal: controller.signal }).then(
        (response) => response.json() as Promise<{ country_name?: string; country?: string }>,
      ),
    ])
      .then((results) => {
        if (controller.signal.aborted) return;

        const nextInsight: VisitorInsight = {
          totalVisitors: null,
          country: null,
        };

        const [countResult, locationResult] = results;

        if (countResult.status === 'fulfilled' && typeof countResult.value?.value === 'number') {
          nextInsight.totalVisitors = countResult.value.value;
          if (!alreadyTrackedToday) {
            window.localStorage.setItem(storageKey, today);
          }
        }

        if (locationResult.status === 'fulfilled') {
          nextInsight.country = locationResult.value.country_name ?? locationResult.value.country ?? null;
        }

        setVisitorInsight(nextInsight);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setVisitorInsight({ totalVisitors: null, country: null });
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!isLibraryHome) return;

    const normalizedQuery = libraryQuery.trim();
    if (normalizedQuery.length < 2) return;

    const timer = window.setTimeout(() => {
      setRecentSearchQueries((current) => rememberRecentSearch(current, normalizedQuery));
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isLibraryHome, libraryQuery]);

  useEffect(() => {
    if (!isLibraryHome || !restoreLibraryScrollRef.current) return;

    const savedScrollY = readLibraryScrollPosition();
    restoreLibraryScrollRef.current = false;

    if (savedScrollY === null) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'auto' });
      });
    });
  }, [isLibraryHome]);

  useEffect(() => {
    if (isLibraryHome || isReaderSearching) {
      setChapterScrollProgress(0);
      return;
    }

    const updateChapterScrollProgress = () => {
      const element = contentCardRef.current;
      if (!element) {
        setChapterScrollProgress(0);
        return;
      }

      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight || 1;
      const progressStart = viewportHeight * 0.2;
      const totalScrollableDistance = Math.max(element.scrollHeight - viewportHeight * 0.72, 1);
      const consumedDistance = Math.min(Math.max(progressStart - rect.top, 0), totalScrollableDistance);
      setChapterScrollProgress(consumedDistance / totalScrollableDistance);
    };

    updateChapterScrollProgress();
    window.addEventListener('scroll', updateChapterScrollProgress, { passive: true });
    window.addEventListener('resize', updateChapterScrollProgress);

    return () => {
      window.removeEventListener('scroll', updateChapterScrollProgress);
      window.removeEventListener('resize', updateChapterScrollProgress);
    };
  }, [activeChapter?.id, isLibraryHome, isReaderSearching]);

  useEffect(() => {
    const handlePopState = () => {
      const route = getInitialRouteState();
      setLanguage(LOCKED_LANGUAGE);

      if (!route.bookId) {
        setOpeningBookId(null);
        setTransitionMode('library');
        restoreLibraryScrollRef.current = true;
        setSelectedBookId(null);
        setChapterIndex(0);
        setReaderQuery('');
        return;
      }

      const routeBook = LIBRARY.find((entry) => entry.id === route.bookId) ?? LIBRARY[0];
  const routeTranslation = getTranslation(routeBook, LOCKED_LANGUAGE);
      const routeChapterIndex = routeTranslation.chapters.findIndex((chapter) => chapter.id === route.chapterId);

        setOpeningBookId(null);
      setTransitionMode('reader');
      setSelectedBookId(routeBook.id);
      setChapterIndex(routeChapterIndex >= 0 ? routeChapterIndex : 0);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleReaderQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setReaderQuery(event.target.value);
  };

  const handleLibraryQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setLibraryQuery(event.target.value);
  };

  const handleLibrarySearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!libraryQuery.trim() || !actionableSearchResults.length) {
      if (event.key === 'Escape' && libraryQuery) {
        setLibraryQuery('');
      }
      return;
    }

    const currentIndex = Math.max(0, actionableSearchResults.findIndex((result) => result.id === activeSearchResultId));

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = (currentIndex + 1) % actionableSearchResults.length;
      setActiveSearchResultId(actionableSearchResults[nextIndex]?.id ?? null);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = (currentIndex - 1 + actionableSearchResults.length) % actionableSearchResults.length;
      setActiveSearchResultId(actionableSearchResults[nextIndex]?.id ?? null);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const activeResult = actionableSearchResults[currentIndex];
      if (activeResult) {
        handleOpenBookFromLibrary(activeResult.bookId, activeResult.chapterIndex);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setLibraryQuery('');
      setActiveSearchResultId(null);
    }
  };

  const handleApplyRecentSearch = (query: string) => {
    setLibraryQuery(query);
  };

  const handleClearRecentSearches = () => {
    setRecentSearchQueries([]);
  };

  const togglePinnedSearch = (query: string, event?: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();

    setPinnedSearchQueries((current) => {
      const exists = current.some((entry) => entry.toLowerCase() === query.toLowerCase());
      if (exists) {
        return current.filter((entry) => entry.toLowerCase() !== query.toLowerCase());
      }

      return rememberPinnedSearch(current, query);
    });
  };

  const handleClearPinnedSearches = () => {
    setPinnedSearchQueries([]);
  };

  const handleResetDiscoveryState = () => {
    setLibraryQuery('');
    setLibraryFilter('all');
    setLibrarySort('featured');
    setActiveSearchResultId(null);
  };

  const handleBrowseCollections = () => {
    document.querySelector('.biblioteka-collection-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleContinueReading = () => {
    if (!continueReadingBook || !lastReading) return;

    const continueTranslation = getTranslation(continueReadingBook, lastReading.language);
    const nextChapterIndex = continueTranslation.chapters.findIndex((chapter) => chapter.id === lastReading.chapterId);
    navigateTo(lastReading.language, continueReadingBook.id, nextChapterIndex >= 0 ? nextChapterIndex : 0);
  };

  const handleOpenNextChapterRecommendation = () => {
    if (!nextChapterRecommendation) return;

    navigateTo(
      lastReading?.language ?? language,
      nextChapterRecommendation.book.id,
      nextChapterRecommendation.chapterIndex,
    );
  };

  const toggleFavoriteBook = (bookId: string, event?: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();

    setFavoriteBookIds((current) => {
      if (current.includes(bookId)) {
        return current.filter((entry) => entry !== bookId);
      }

      return [bookId, ...current];
    });
  };

  const toggleTopicPathStepCompletion = (stepKey: string, event?: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();

    setCompletedTopicPathSteps((current) => {
      if (current.includes(stepKey)) {
        return current.filter((entry) => entry !== stepKey);
      }

      return [...current, stepKey];
    });
  };

  const resetTopicPathProgress = (topicKey: string, event?: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();

    setCompletedTopicPathSteps((current) => current.filter((entry) => !entry.startsWith(`${topicKey}::`)));
  };

  const handleOpenBookFromLibrary = (nextBookId: string, nextChapterIndex = 0) => {
    if (openingBookId) return;

    if (libraryQuery.trim()) {
      setRecentSearchQueries((current) => rememberRecentSearch(current, libraryQuery));
    }

    saveLibraryScrollPosition();
    setOpeningBookId(nextBookId);
    setTransitionMode('reader');

    openBookTimerRef.current = window.setTimeout(() => {
      navigateTo(language, nextBookId, nextChapterIndex);
    }, 210);
  };

  const handleOpenReaderSearchResult = (nextChapterIndex: number) => {
    setReaderQuery('');
    navigateTo(language, activeBookId, nextChapterIndex);
  };

  const handleScrollToChapterTop = () => {
    const element = contentCardRef.current;
    if (!element) return;

    const top = window.scrollY + element.getBoundingClientRect().top - 84;
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
  };

  const handleAdjustReaderTextScale = (direction: 'decrease' | 'increase') => {
    setReaderTextScale((current) => {
      const delta = direction === 'increase' ? 0.08 : -0.08;
      const next = Number((current + delta).toFixed(2));
      return Math.min(1.28, Math.max(0.88, next));
    });
  };

  return (
    <div className={`reader-root biblioteka-app ${isLibraryHome ? 'mode-library' : 'mode-reader'} biblioteka-transition-${transitionMode}`}>
      {!isLibraryHome ? (
        <div className="reader-opening-hero-shell">
          <section
            className="reader-opening-hero"
            style={{
              backgroundImage: 'none',
              background: featuredBook.coverGradient,
              '--book-accent': featuredBook.accent,
            } as CSSProperties}
          >
            <div className="reader-opening-hero-content">
              <div className="reader-opening-hero-panel">
                <div className="reader-opening-hero-copy">
                  <div className="reader-opening-hero-kicker">EGV Biblioteka</div>
                  <div className="reader-opening-hero-booktitle">{heroTitle}</div>
                  <p className="reader-opening-hero-description">{heroDescription}</p>

                  <div className="reader-opening-hero-meta">
                    {heroMeta.map((item) => (
                      <span key={item} className="reader-opening-hero-chip">{item}</span>
                    ))}
                  </div>

                  {heroCopy.length ? (
                    <div className="reader-opening-hero-lines">
                      {heroCopy.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  ) : null}

                </div>

                <div className="reader-opening-hero-cover" aria-hidden="true">
                  <div className="reader-opening-hero-cover-inner">
                    <div className="reader-opening-hero-cover-title">{heroTitle}</div>
                    <div className="reader-opening-hero-cover-subtitle">{translation.author}</div>
                    <div className="reader-opening-hero-cover-line" />
                    <div className="reader-opening-hero-cover-chapter">{activeChapterTitle}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <header className="reader-header-bar">
        <div className="reader-header-bar-inner">
          <div className="reader-header-controls">
            <div className="reader-title-center reader-header-title">{isLibraryHome ? 'EGV Biblioteka' : translation.title}</div>
            <div className="biblioteka-toolbar-group">
              {!isLibraryHome ? (
                <button className="biblioteka-back-button" type="button" onClick={() => navigateHome(language)}>
                  <MdArrowBack />
                  <span>Biblioteka</span>
                </button>
              ) : null}

              <button
                className="reader-darkmode-toggle"
                type="button"
                aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                onClick={() => setDark((value) => !value)}
              >
                {dark ? <MdLightMode /> : <MdDarkMode />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {isLibraryHome ? (
      <section className="biblioteka-library-landing biblioteka-view-panel biblioteka-library-panel">
        <div className="biblioteka-library-landing-inner">
          <div className="biblioteka-library-heading">
            <div>
              <div className="biblioteka-eyebrow">Kolekcija</div>
              <h2>Istraži biblioteku</h2>
              <p>
                Izaberi knjigu iz kolekcije i nastavi čitanje kroz uređeni prikaz sa poglavljima, pretragom i rutiranjem.
              </p>
            </div>
            <div className="biblioteka-library-summary">
              <span className="biblioteka-library-summary-pill">{LIBRARY.length} knjiga</span>
              <span className="biblioteka-library-summary-pill">{LANGUAGE_LABELS[language]}</span>
            </div>
          </div>

          <div className="biblioteka-top-search biblioteka-card biblioteka-stagger-enter" style={{ '--stagger-delay': '40ms' } as CSSProperties}>
            <div className="biblioteka-top-search-copy">
              <div className="biblioteka-eyebrow">Pretraga biblioteke</div>
              <h3>Pretraživanje</h3>
              <p>Pretraži po naslovu, opisu, poglavljima i tematskim celinama direktno sa vrha početne strane.</p>
            </div>

            <label className="biblioteka-search-wrap biblioteka-library-search-wrap biblioteka-top-search-wrap">
              <MdSearch />
              <input
                type="search"
                value={libraryQuery}
                onChange={handleLibraryQueryChange}
                onKeyDown={handleLibrarySearchKeyDown}
                placeholder="Pretraži biblioteku…"
              />
            </label>

            <div className="biblioteka-search-hint biblioteka-top-search-hint" aria-live="polite">
              <span><kbd>↑</kbd><kbd>↓</kbd> kretanje</span>
              <span><kbd>Enter</kbd> otvori</span>
              <span><kbd>Esc</kbd> obriši</span>
            </div>

            <div className="biblioteka-top-search-suggestions">
              <div className="biblioteka-search-history biblioteka-top-search-section biblioteka-quick-topics">
                <div className="biblioteka-search-history-header">
                  <div>
                    <div className="biblioteka-eyebrow">Brze teme</div>
                    <div className="biblioteka-quick-topics-copy">Jednim dodirom pokreni najčešće tematske ulaze u biblioteku.</div>
                  </div>
                </div>

                <div className="biblioteka-search-history-row">
                  {EDITORIAL_QUICK_TOPICS.map((topic) => {
                    const isActive = libraryQuery.trim().toLowerCase() === topic.toLowerCase();

                    return (
                      <button
                        key={`top-quick-topic-${topic}`}
                        type="button"
                        className={`biblioteka-search-history-chip quick-topic ${isActive ? 'active' : ''}`}
                        onClick={() => handleApplyRecentSearch(topic)}
                      >
                        {topic}
                      </button>
                    );
                  })}
                </div>
              </div>

              {pinnedSearchQueries.length ? (
                <div className="biblioteka-search-history biblioteka-top-search-section biblioteka-search-history-pinned">
                  <div className="biblioteka-search-history-header">
                    <div className="biblioteka-eyebrow">Zakačene pretrage</div>
                    <button type="button" className="biblioteka-search-history-clear" onClick={handleClearPinnedSearches}>
                      Očisti zakačene
                    </button>
                  </div>

                  <div className="biblioteka-search-history-row">
                    {pinnedSearchQueries.map((query) => (
                      <div key={`top-pinned-query-${query}`} className="biblioteka-search-history-item pinned">
                        <button
                          type="button"
                          className="biblioteka-search-history-chip pinned"
                          onClick={() => handleApplyRecentSearch(query)}
                        >
                          <MdPushPin />
                          <span>{query}</span>
                        </button>
                        <button
                          type="button"
                          className="biblioteka-search-history-pin active"
                          aria-label="Ukloni zakačenu pretragu"
                          onClick={(event) => togglePinnedSearch(query, event)}
                        >
                          <MdPushPin />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {recentSearchQueries.length ? (
                <div className="biblioteka-search-history biblioteka-top-search-section biblioteka-top-search-section-recent">
                  <div className="biblioteka-search-history-header">
                    <div className="biblioteka-eyebrow">Nedavne pretrage</div>
                    <button type="button" className="biblioteka-search-history-clear" onClick={handleClearRecentSearches}>
                      Očisti istoriju
                    </button>
                  </div>

                  <div className="biblioteka-search-history-row">
                    {recentSearchQueries.map((query) => (
                      <div key={`top-recent-query-${query}`} className="biblioteka-search-history-item">
                        <button
                          type="button"
                          className="biblioteka-search-history-chip"
                          onClick={() => handleApplyRecentSearch(query)}
                        >
                          {query}
                        </button>
                        <button
                          type="button"
                          className={`biblioteka-search-history-pin ${pinnedSearchQueries.some((entry) => entry.toLowerCase() === query.toLowerCase()) ? 'active' : ''}`}
                          aria-label={pinnedSearchQueries.some((entry) => entry.toLowerCase() === query.toLowerCase()) ? 'Otkači pretragu' : 'Zakači pretragu'}
                          onClick={(event) => togglePinnedSearch(query, event)}
                        >
                          {pinnedSearchQueries.some((entry) => entry.toLowerCase() === query.toLowerCase()) ? <MdPushPin /> : <MdOutlinePushPin />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <section className="biblioteka-devotional biblioteka-card biblioteka-stagger-enter" style={{ '--stagger-delay': '85ms' } as CSSProperties}>
            <button
              type="button"
              className={`biblioteka-devotional-trigger ${isDailyDevotionalOpen ? 'is-open' : ''}`}
              aria-expanded={isDailyDevotionalOpen}
              onClick={() => setIsDailyDevotionalOpen((current) => !current)}
            >
              <div className="biblioteka-devotional-trigger-copy">
                <div className="biblioteka-eyebrow">{DAILY_DEVOTIONAL.label}</div>
                <h3>{DAILY_DEVOTIONAL.title}</h3>
              </div>
              <span className="biblioteka-devotional-trigger-icon" aria-hidden="true">⌄</span>
            </button>

            {isDailyDevotionalOpen ? (
              <div className="biblioteka-devotional-body">
                <div className="biblioteka-devotional-source">{DAILY_DEVOTIONAL.source}</div>
                <div className="biblioteka-devotional-content">
                  {DAILY_DEVOTIONAL.paragraphs.map((paragraph, index) => (
                    <p key={`daily-devotional-${index}`}>{paragraph}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <div className={`biblioteka-library-grid ${openingBookId ? 'is-transitioning' : ''}`}>
            {filteredLibraryBooks.map((book: Book, index: number) => {
              const item = getTranslation(book, language);
              const isOpening = openingBookId === book.id;
              const isContinueReading = lastReading?.bookId === book.id;
              const isFavorite = favoriteBookIds.includes(book.id);
              const isTopicPriority = activeTopicBookPriority.has(book.id);
              const isFeaturedShelfCard = libraryFilter === 'all' && librarySort === 'featured' && !libraryQuery.trim() && index < 2;
              const savedChapterIndex = isContinueReading
                ? item.chapters.findIndex((chapter) => chapter.id === lastReading?.chapterId)
                : -1;
              const savedChapterTitle = savedChapterIndex >= 0 ? item.chapters[savedChapterIndex]?.title : null;
              const nextChapterIndex = savedChapterIndex >= 0 ? savedChapterIndex : 0;

              return (
                <button
                  key={book.id}
                  type="button"
                  className={`biblioteka-library-card biblioteka-stagger-enter ${isOpening ? 'is-opening' : ''} ${isFeaturedShelfCard ? 'is-featured' : ''}`}
                  style={{
                    '--book-accent': book.accent,
                    '--book-gradient': book.coverGradient,
                    '--stagger-delay': `${120 + Math.min(index, 7) * 70}ms`,
                  } as CSSProperties}
                  onClick={() => handleOpenBookFromLibrary(book.id, nextChapterIndex)}
                  disabled={Boolean(openingBookId)}
                >
                  <div className="biblioteka-library-cover">
                    <div className="biblioteka-library-cover-inner">
                      <div className="biblioteka-library-cover-title">{item.title}</div>
                      <div className="biblioteka-library-cover-author">{item.author}</div>
                    </div>
                  </div>

                  <div className="biblioteka-library-card-body">
                    <div className="biblioteka-library-card-topline">
                      <span className="biblioteka-library-card-label">{isContinueReading ? 'Nastavi čitanje' : 'Knjiga'}</span>
                      <div className="biblioteka-library-card-meta">
                        {isFeaturedShelfCard ? <span className="biblioteka-library-card-featured">Izdvojeno</span> : null}
                        {isTopicPriority ? <span className="biblioteka-library-card-topic">Tematski fokus</span> : null}
                        {isFavorite ? <span className="biblioteka-library-card-favorite">Omiljena</span> : null}
                        <span className="biblioteka-library-card-chapters">{item.chapters.length} poglavlja</span>
                      </div>
                    </div>

                    {isContinueReading && savedChapterTitle ? (
                      <div className="biblioteka-library-card-progress">Poslednje poglavlje: {savedChapterTitle}</div>
                    ) : null}

                    <h3>{item.title}</h3>
                    <p>{item.description}</p>

                    <div className="biblioteka-library-card-footer">
                      <span>{item.author}</span>
                      <div className="biblioteka-library-card-footer-actions">
                        <button
                          type="button"
                          className={`biblioteka-favorite-toggle ${isFavorite ? 'active' : ''}`}
                          aria-label={isFavorite ? 'Ukloni iz omiljenih' : 'Dodaj u omiljene'}
                          onClick={(event) => toggleFavoriteBook(book.id, event)}
                        >
                          {isFavorite ? <MdStar /> : <MdOutlineStar />}
                        </button>
                        <span className="biblioteka-library-card-action">{isContinueReading ? 'Nastavi →' : 'Otvori →'}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="biblioteka-discovery-panel biblioteka-card">
            <div className="biblioteka-discovery-topline">
              <div>
                <div className="biblioteka-eyebrow">Otkrivanje</div>
                <h3>Teme, rezultati i preporuke</h3>
              </div>
            </div>

            {topicSpotlight ? (
              <div className="biblioteka-topic-spotlight biblioteka-card">
                <div className="biblioteka-topic-spotlight-copy">
                  <div className="biblioteka-eyebrow">Tematski fokus</div>
                  <h4>{topicSpotlight.title}</h4>
                  <p>{topicSpotlight.description}</p>
                </div>

                {topicSpotlight.books.length ? (
                  <div className="biblioteka-topic-spotlight-books">
                    {topicSpotlight.books.map((book) => {
                      const item = getTranslation(book, language);
                      const savedChapterIndex = lastReading?.bookId === book.id
                        ? item.chapters.findIndex((chapter) => chapter.id === lastReading?.chapterId)
                        : -1;
                      const nextChapterIndex = savedChapterIndex >= 0 ? savedChapterIndex : 0;

                      return (
                        <button
                          key={`spotlight-${topicSpotlight.key}-${book.id}`}
                          type="button"
                          className="biblioteka-topic-spotlight-book"
                          style={{ '--book-accent': book.accent, '--book-gradient': book.coverGradient } as CSSProperties}
                          onClick={() => handleOpenBookFromLibrary(book.id, nextChapterIndex)}
                          disabled={Boolean(openingBookId)}
                        >
                          <div className="biblioteka-topic-spotlight-book-title">{item.title}</div>
                          <div className="biblioteka-topic-spotlight-book-meta">{item.chapters.length} poglavlja</div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {topicSpotlight.path.length && topicPathProgress ? (
                  <div className="biblioteka-topic-path">
                    <div className="biblioteka-topic-path-heading">
                      <div>
                        <div className="biblioteka-eyebrow">Put čitanja</div>
                        <h5>Kako da kreneš kroz ovu temu</h5>
                      </div>
                      <div className="biblioteka-topic-path-actions">
                        <div className="biblioteka-topic-path-progress">
                          {topicPathProgress.completedCount}/{topicPathProgress.steps.length} završeno
                        </div>
                        {topicPathProgress.completedCount ? (
                          <button
                            type="button"
                            className="biblioteka-topic-path-reset"
                            onClick={(event) => resetTopicPathProgress(topicSpotlight.key, event)}
                          >
                            Resetuj put
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="biblioteka-topic-path-steps">
                      {topicPathProgress.steps.map((step, index) => {
                        const book = LIBRARY.find((entry) => entry.id === step.bookId);
                        if (!book) return null;

                        const item = getTranslation(book, language);
                        const savedChapterIndex = lastReading?.bookId === book.id
                          ? item.chapters.findIndex((chapter) => chapter.id === lastReading?.chapterId)
                          : -1;
                        const nextChapterIndex = savedChapterIndex >= 0 ? savedChapterIndex : 0;
                        const isRecommended = topicPathProgress.recommendedIndex === index;

                        return (
                          <div
                            key={`topic-path-${topicSpotlight.key}-${step.bookId}`}
                            className={`biblioteka-topic-path-step ${step.visited ? 'visited' : ''} ${step.isCurrent ? 'current' : ''} ${step.completed ? 'completed' : ''} ${isRecommended ? 'recommended' : ''}`}
                            style={{ '--book-accent': book.accent } as CSSProperties}
                          >
                            <button
                              type="button"
                              className="biblioteka-topic-path-step-main"
                              onClick={() => handleOpenBookFromLibrary(book.id, nextChapterIndex)}
                              disabled={Boolean(openingBookId)}
                            >
                              <div className={`biblioteka-topic-path-step-order ${step.completed ? 'completed' : ''}`}>
                                {step.completed ? '✓' : index + 1}
                              </div>
                              <div className="biblioteka-topic-path-step-copy">
                                <div className="biblioteka-topic-path-step-topline">
                                  <div className="biblioteka-topic-path-step-label">{step.label}</div>
                                  <div className="biblioteka-topic-path-step-state">
                                    {step.completed ? <span className="biblioteka-topic-path-badge completed">Završeno</span> : null}
                                    {step.isCurrent ? <span className="biblioteka-topic-path-badge current">Trenutno</span> : null}
                                    {!step.isCurrent && !step.completed && step.visited ? <span className="biblioteka-topic-path-badge visited">Otvoreno</span> : null}
                                    {isRecommended && !step.completed ? <span className="biblioteka-topic-path-badge recommended">Sledeće</span> : null}
                                  </div>
                                </div>
                                <strong>{item.title}</strong>
                                <span>{step.note}</span>
                              </div>
                            </button>

                            <button
                              type="button"
                              className={`biblioteka-topic-path-toggle ${step.completed ? 'completed' : ''}`}
                              aria-pressed={step.completed}
                              onClick={(event) => toggleTopicPathStepCompletion(step.completionKey, event)}
                            >
                              {step.completed ? 'Označeno' : 'Označi završeno'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {topicSpotlight.collections.length ? (
                  <div className="biblioteka-topic-spotlight-collections">
                    {topicSpotlight.collections.map((collection) => (
                      <button
                        key={`spotlight-collection-${collection.id}`}
                        type="button"
                        className="biblioteka-topic-spotlight-collection"
                        onClick={handleBrowseCollections}
                      >
                        <strong>{collection.title}</strong>
                        <span>{collection.description}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {libraryQuery.trim() ? (
              <div className="biblioteka-discovery-results">
                <div className="biblioteka-discovery-summary">
                  <span className="biblioteka-library-summary-pill">{discoveryResults.books.length} knjiga</span>
                  <span className="biblioteka-library-summary-pill">{discoveryResults.chapters.length} pasusa</span>
                  <span className="biblioteka-library-summary-pill">{discoveryResults.collections.length} kolekcije</span>
                </div>

                {librarySearchLoading ? (
                  <div className="biblioteka-placeholder-text">Učitavam indeks pretrage biblioteke…</div>
                ) : null}

                {librarySearchError ? (
                  <div className="biblioteka-language-notice">{librarySearchError}</div>
                ) : null}

                {groupedDiscoveryChapters.length ? (
                  <div className="biblioteka-discovery-chapter-list">
                    {groupedDiscoveryChapters.map(({ book, translation: item, hits }) => (
                      <section
                        key={`content-group-${book.id}`}
                        className="biblioteka-discovery-chapter-group"
                        style={{ '--book-accent': book.accent } as CSSProperties}
                      >
                        <div className="biblioteka-discovery-chapter-group-header">
                          <div>
                            <div className="biblioteka-discovery-card-reason">Tekst poglavlja</div>
                            <h4>{item.title}</h4>
                          </div>
                          <div className="biblioteka-discovery-group-count">{hits.length} pogodaka</div>
                        </div>

                        <div className="biblioteka-discovery-chapter-group-hits">
                          {hits.map(({ entry, chapterIndex, snippet }) => (
                            <button
                              key={`content-${book.id}-${entry.chapterId}`}
                              type="button"
                              className={`biblioteka-discovery-chapter-card ${activeSearchResultId === `chapter-${book.id}-${entry.chapterId}` ? 'active' : ''}`}
                              onClick={() => handleOpenBookFromLibrary(book.id, chapterIndex)}
                              disabled={Boolean(openingBookId)}
                              ref={(node) => {
                                searchResultRefs.current[`chapter-${book.id}-${entry.chapterId}`] = node;
                              }}
                            >
                              <div className="biblioteka-discovery-chapter-title">
                                {getHighlightedParts(entry.chapterTitle, libraryQuery).map((part, index) => (
                                  part.match ? <mark key={`${entry.chapterId}-title-${index}`}>{part.text}</mark> : <span key={`${entry.chapterId}-title-${index}`}>{part.text}</span>
                                ))}
                              </div>
                              <p>
                                {getHighlightedParts(snippet, libraryQuery).map((part, index) => (
                                  part.match ? <mark key={`${entry.chapterId}-snippet-${index}`}>{part.text}</mark> : <span key={`${entry.chapterId}-snippet-${index}`}>{part.text}</span>
                                ))}
                              </p>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : null}

                {discoveryResults.books.length ? (
                  <div className="biblioteka-discovery-grid">
                    {discoveryResults.books.map(({ book, translation: item, matchedChapter, matchedChapterIndex, reason }) => {
                      const savedChapterIndex = lastReading?.bookId === book.id
                        ? item.chapters.findIndex((chapter) => chapter.id === lastReading?.chapterId)
                        : -1;
                      const nextChapterIndex = matchedChapterIndex ?? (savedChapterIndex >= 0 ? savedChapterIndex : 0);
                      const chapterTargetLabel = matchedChapter ? `Otvori poglavlje: ${matchedChapter}` : savedChapterIndex >= 0 ? `Nastavi od: ${item.chapters[savedChapterIndex]?.title}` : 'Otvori knjigu';

                      return (
                        <button
                          key={`discovery-${book.id}`}
                          type="button"
                          className={`biblioteka-discovery-card ${activeSearchResultId === `book-${book.id}` ? 'active' : ''}`}
                          style={{ '--book-accent': book.accent } as CSSProperties}
                          onClick={() => handleOpenBookFromLibrary(book.id, nextChapterIndex)}
                          disabled={Boolean(openingBookId)}
                          ref={(node) => {
                            searchResultRefs.current[`book-${book.id}`] = node;
                          }}
                        >
                          <div className="biblioteka-discovery-card-reason">{reason}</div>
                          <h4>{item.title}</h4>
                          <p>{matchedChapter ? `Poklapanje u poglavlju: ${matchedChapter}` : item.description}</p>
                          <div className="biblioteka-discovery-card-target">{chapterTargetLabel}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {discoveryResults.collections.length ? (
                  <div className="biblioteka-discovery-collections">
                    {discoveryResults.collections.map((collection) => (
                      <div key={`match-${collection.id}`} className="biblioteka-discovery-collection-item">
                        <div className="biblioteka-eyebrow">Tematska celina</div>
                        <strong>{collection.title}</strong>
                        <span>{collection.description}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {hasNoDiscoveryResults ? (
                  <div className="biblioteka-discovery-empty biblioteka-card">
                    <div className="biblioteka-discovery-empty-copy">
                      <div className="biblioteka-eyebrow">Bez rezultata</div>
                      <h4>Ništa se nije poklopilo sa „{libraryQuery}”</h4>
                      <p>
                        Probaj širi pojam, vrati filtere na podrazumevano ili preskoči pravo na preporuke i tematske kolekcije ispod.
                      </p>
                    </div>

                    <div className="biblioteka-discovery-empty-actions">
                      <button type="button" className="biblioteka-discovery-empty-button primary" onClick={handleResetDiscoveryState}>
                        Očisti pretragu i filtere
                      </button>
                      {continueReadingBook ? (
                        <button type="button" className="biblioteka-discovery-empty-button" onClick={handleContinueReading}>
                          Nastavi poslednje čitanje
                        </button>
                      ) : null}
                      <button type="button" className="biblioteka-discovery-empty-button" onClick={handleBrowseCollections}>
                        Pregledaj tematske kolekcije
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="biblioteka-placeholder-text">
                Pretraži celu biblioteku preko naslova, opisa, poglavlja i uredničkih kolekcija pre nego što uđeš u čitač.
              </p>
            )}
          </div>

          {nextChapterRecommendation ? (
            <div className="biblioteka-next-step-card biblioteka-card">
              <div className="biblioteka-next-step-copy">
                <div className="biblioteka-eyebrow">Sledeći korak</div>
                <h3>Preporučeno sledeće poglavlje</h3>
                <p>
                  Posle poglavlja “{nextChapterRecommendation.currentChapterTitle}” u knjizi <strong>{nextChapterRecommendation.translation.title}</strong>,
                  sledeće prirodno otvaranje je “{nextChapterRecommendation.nextChapterTitle}”.
                </p>
              </div>

              <button
                type="button"
                className="biblioteka-next-step-action"
                onClick={handleOpenNextChapterRecommendation}
              >
                <MdMenuBook />
                <span>Otvori sledeće poglavlje</span>
              </button>
            </div>
          ) : null}

          {favoriteBooks.length ? (
            <div className="biblioteka-favorites-shelf">
              <div className="biblioteka-favorites-heading">
                <div>
                  <div className="biblioteka-eyebrow">Brzi pristup</div>
                  <h3>Omiljene knjige</h3>
                </div>
                <span className="biblioteka-library-summary-pill">{favoriteBooks.length} sačuvano</span>
              </div>

              <div className="biblioteka-favorites-row">
                {favoriteBooks.map((book) => {
                  const item = getTranslation(book, language);
                  const isFavorite = favoriteBookIds.includes(book.id);
                  const isContinueReading = lastReading?.bookId === book.id;
                  const savedChapterIndex = isContinueReading
                    ? item.chapters.findIndex((chapter) => chapter.id === lastReading?.chapterId)
                    : -1;
                  const nextChapterIndex = savedChapterIndex >= 0 ? savedChapterIndex : 0;

                  return (
                    <div key={`favorite-${book.id}`} className="biblioteka-favorite-pill" style={{ '--book-accent': book.accent } as CSSProperties}>
                      <button
                        type="button"
                        className="biblioteka-favorite-pill-link"
                        onClick={() => handleOpenBookFromLibrary(book.id, nextChapterIndex)}
                        disabled={Boolean(openingBookId)}
                      >
                        <span className="biblioteka-favorite-pill-title">{item.title}</span>
                      </button>
                      <button
                        type="button"
                        className={`biblioteka-favorite-toggle inline ${isFavorite ? 'active' : ''}`}
                        aria-label={isFavorite ? 'Ukloni iz omiljenih' : 'Dodaj u omiljene'}
                        onClick={(event) => toggleFavoriteBook(book.id, event)}
                      >
                        {isFavorite ? <MdStar /> : <MdOutlineStar />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {recentLibraryItems.length ? (
            <div className="biblioteka-recents-shelf">
              <div className="biblioteka-favorites-heading">
                <div>
                  <div className="biblioteka-eyebrow">Nedavno otvoreno</div>
                  <h3>Nastavi brzo</h3>
                </div>
                <span className="biblioteka-library-summary-pill">{recentLibraryItems.length} u istoriji</span>
              </div>

              <div className="biblioteka-recents-row">
                {recentLibraryItems.map(({ book, item, savedChapterIndex, savedChapterTitle }) => (
                  <button
                    key={`recent-${book.id}`}
                    type="button"
                    className="biblioteka-recent-card"
                    style={{ '--book-accent': book.accent, '--book-gradient': book.coverGradient } as CSSProperties}
                    onClick={() => handleOpenBookFromLibrary(book.id, savedChapterIndex)}
                    disabled={Boolean(openingBookId)}
                  >
                    <div className="biblioteka-recent-card-topline">
                      <span className="biblioteka-library-card-label">Nedavno</span>
                      <span className="biblioteka-library-card-chapters">{item.language.toUpperCase()}</span>
                    </div>
                    <div className="biblioteka-recent-card-title">{item.title}</div>
                    <div className="biblioteka-recent-card-meta">{savedChapterTitle ? `Nastavi od: ${savedChapterTitle}` : 'Otvori knjigu'}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="biblioteka-library-controls">
            <div className="biblioteka-filter-bar">
              {LIBRARY_FILTERS.map((filter) => {
                const isActive = libraryFilter === filter.id;

                return (
                  <button
                    key={filter.id}
                    type="button"
                    className={`biblioteka-filter-chip ${isActive ? 'active' : ''}`}
                    onClick={() => setLibraryFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>

            <div className="biblioteka-sort-bar" aria-label="Sortiranje biblioteke">
              {LIBRARY_SORTS.map((sort) => {
                const isActive = librarySort === sort.id;

                return (
                  <button
                    key={sort.id}
                    type="button"
                    className={`biblioteka-sort-chip ${isActive ? 'active' : ''}`}
                    onClick={() => setLibrarySort(sort.id)}
                  >
                    {sort.label}
                  </button>
                );
              })}
            </div>

            {topicSpotlight ? (
              <div className="biblioteka-topic-priority-note">
                <span className="biblioteka-library-summary-pill">Fokus teme: {libraryQuery.trim()}</span>
                <span className="biblioteka-topic-priority-copy">Najrelevantnije knjige za ovu temu podignute su na vrh biblioteke.</span>
              </div>
            ) : null}
          </div>

          {recommendationBlocks.length ? (
            <div className="biblioteka-guidance-grid">
              {recommendationBlocks.map((block) => (
                <section key={block.id} className="biblioteka-guidance-block biblioteka-card">
                  <div className="biblioteka-guidance-heading">
                    <div className="biblioteka-eyebrow">{block.eyebrow}</div>
                    <h3>{block.title}</h3>
                    <p>{block.description}</p>
                  </div>

                  <div className="biblioteka-guidance-row">
                    {block.books.map((book) => {
                      const item = getTranslation(book, language);
                      const savedChapterIndex = lastReading?.bookId === book.id
                        ? item.chapters.findIndex((chapter) => chapter.id === lastReading?.chapterId)
                        : -1;
                      const nextChapterIndex = savedChapterIndex >= 0 ? savedChapterIndex : 0;

                      return (
                        <button
                          key={`${block.id}-${book.id}`}
                          type="button"
                          className="biblioteka-guidance-card"
                          style={{ '--book-accent': book.accent, '--book-gradient': book.coverGradient } as CSSProperties}
                          onClick={() => handleOpenBookFromLibrary(book.id, nextChapterIndex)}
                          disabled={Boolean(openingBookId)}
                        >
                          <div className="biblioteka-guidance-card-title">{item.title}</div>
                          <div className="biblioteka-guidance-card-meta">{item.chapters.length} poglavlja · {item.author}</div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : null}

          {curatedCollections.map((collection) => (
            <section key={collection.id} className="biblioteka-collection-block">
              <div className="biblioteka-collection-heading">
                <div>
                  <div className="biblioteka-eyebrow">{collection.eyebrow}</div>
                  <h3>{collection.title}</h3>
                  <p>{collection.description}</p>
                </div>
              </div>

              <div className="biblioteka-collection-grid">
                {collection.books.map((book) => {
                  const item = getTranslation(book, language);
                  const savedChapterIndex = lastReading?.bookId === book.id
                    ? item.chapters.findIndex((chapter) => chapter.id === lastReading?.chapterId)
                    : -1;
                  const nextChapterIndex = savedChapterIndex >= 0 ? savedChapterIndex : 0;

                  return (
                    <button
                      key={`${collection.id}-${book.id}`}
                      type="button"
                      className="biblioteka-collection-card"
                      style={{ '--book-accent': book.accent, '--book-gradient': book.coverGradient } as CSSProperties}
                      onClick={() => handleOpenBookFromLibrary(book.id, nextChapterIndex)}
                      disabled={Boolean(openingBookId)}
                    >
                      <div className="biblioteka-collection-card-title">{item.title}</div>
                      <div className="biblioteka-collection-card-meta">{item.chapters.length} poglavlja</div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

        </div>
      </section>
      ) : null}

      {!isLibraryHome ? (
      <main className="reader-main biblioteka-layout biblioteka-view-panel biblioteka-reader-panel">
        <aside className="biblioteka-sidebar biblioteka-card" style={{ '--book-accent': activeBook?.accent ?? featuredBook.accent } as CSSProperties}>
          <div className="biblioteka-sidebar-section biblioteka-sidebar-bookhead">
            <div className="biblioteka-eyebrow">Biblioteka</div>
            <h2>{translation.title}</h2>
            <div className="biblioteka-sidebar-meta">
              <span className="biblioteka-sidebar-pill">{translation.author}</span>
              <span className="biblioteka-sidebar-pill">{translation.chapters.length} poglavlja</span>
              <span className="biblioteka-sidebar-pill">{LANGUAGE_LABELS[translation.language]}</span>
            </div>
            <p>{translation.description}</p>

            <div className="biblioteka-sidebar-progress-block">
              <div className="biblioteka-sidebar-progress-topline">
                <span>Napredak kroz knjigu</span>
                <strong>{chapterProgressPercent}%</strong>
              </div>
              <div className="biblioteka-sidebar-progress-bar" aria-hidden="true">
                <span style={{ width: `${chapterProgressPercent}%` }} />
              </div>
              <div className="biblioteka-sidebar-progress-caption">{chapterProgressLabel}</div>
            </div>

            <button
              type="button"
              className={`biblioteka-favorite-toggle sidebar ${favoriteBookIds.includes(activeBookId) ? 'active' : ''}`}
              aria-label={favoriteBookIds.includes(activeBookId) ? 'Ukloni iz omiljenih' : 'Dodaj u omiljene'}
              onClick={(event) => toggleFavoriteBook(activeBookId, event)}
            >
              {favoriteBookIds.includes(activeBookId) ? <MdStar /> : <MdOutlineStar />}
              <span>{favoriteBookIds.includes(activeBookId) ? 'Sačuvano u omiljenim' : 'Dodaj u omiljene'}</span>
            </button>
            {usingFallbackTranslation ? (
              <div className="biblioteka-language-notice">
                Prikazujemo srpski sadržaj jer prevod za <strong>{LANGUAGE_LABELS[language]}</strong> još nije dodat za ovu knjigu.
              </div>
            ) : null}
          </div>

          <div className="biblioteka-sidebar-section biblioteka-sidebar-search-section">
            <div className="biblioteka-sidebar-section-heading">
              <div>
                <div className="biblioteka-eyebrow">Pretraga knjige</div>
                <h3>Pronađi pojam</h3>
              </div>
              {readerQuery.trim() && !contentLoading && !contentError ? (
                <span className="biblioteka-sidebar-inline-pill">{chapterMatches.length}</span>
              ) : null}
            </div>
            <label className="biblioteka-search-wrap">
              <MdSearch />
              <input
                type="search"
                value={readerQuery}
                onChange={handleReaderQueryChange}
                placeholder="Pretraži knjige i poglavlja"
              />
            </label>
            <p className="biblioteka-sidebar-helper">Rezultati se otvaraju u glavnom prikazu čim izabereš pogodak.</p>
          </div>

          <div className="biblioteka-sidebar-section biblioteka-sidebar-toc-section">
            <div className="biblioteka-sidebar-section-heading">
              <div>
                <div className="biblioteka-eyebrow">Poglavlja</div>
                <h3>{chapterProgressLabel}</h3>
              </div>
              <span className="biblioteka-sidebar-inline-pill">{translation.chapters.length}</span>
            </div>
            <ul className="reader-toc-list biblioteka-chapters">
              {translation.chapters.map((chapter: Chapter, idx: number) => (
                <li key={chapter.id}>
                  <button
                    className={`reader-toc-item-btn ${idx === chapterIndex ? 'active' : ''}`}
                    onClick={() => navigateTo(language, activeBookId, idx)}
                  >
                    <span className="reader-toc-num">{idx + 1}</span>
                    <span className="reader-toc-copy">
                      <span className="reader-toc-title">{chapter.title}</span>
                      {idx === chapterIndex ? <span className="reader-toc-status">Trenutno</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <section className="biblioteka-reader-column">
          {isReaderSearching ? (
          <div className="biblioteka-card biblioteka-search-results-card biblioteka-search-results-card-prominent">
            <div className="biblioteka-content-header biblioteka-search-results-header">
              <div>
                <div className="biblioteka-eyebrow">Rezultati pretrage</div>
                <h1 className="chapterhead">Rezultati za „{readerQuery.trim()}”</h1>
                {!contentLoading && !contentError ? (
                  <p className="biblioteka-search-results-intro">
                    {chapterMatches.length
                      ? `Pronađeno ${chapterMatches.length} ${chapterMatches.length === 1 ? 'poklapanje' : 'poklapanja'} u otvorenoj knjizi. Izaberi rezultat da otvoriš odgovarajuće poglavlje.`
                      : 'Nema poklapanja u otvorenoj knjizi za ovaj pojam.'}
                  </p>
                ) : null}
              </div>
              {!contentLoading && !contentError && chapterMatches.length ? (
                <div className="biblioteka-search-results-count">{chapterMatches.length} rezultata</div>
              ) : null}
            </div>

            {readerQuery.trim() ? (
              contentLoading ? (
                <div className="biblioteka-placeholder-text">Indeksiram otvorenu knjigu za pretragu…</div>
              ) : contentError ? (
                <div className="reader-search-noresults">{contentError}</div>
              ) : chapterMatches.length ? (
                <div className="reader-search-results biblioteka-results-list">
                  {chapterMatches.map((match) => (
                    <button key={`${match.idx}-${match.title}`} className="reader-search-result" onClick={() => handleOpenReaderSearchResult(match.idx)}>
                      <div className="reader-search-result-topline">
                        <div className="reader-search-chapter">Poglavlje {match.idx + 1}</div>
                        <div className="reader-search-result-action">Otvori</div>
                      </div>
                      <div className="reader-search-result-title">{match.title}</div>
                      <div className="reader-search-result-snippet">{match.snippet}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="reader-search-noresults">Nema rezultata za „{readerQuery}”.</div>
              )
            ) : (
              <div className="biblioteka-placeholder-text">Unesi pojam za pretragu unutar otvorene knjige.</div>
            )}
          </div>
          ) : null}

          {!isReaderSearching ? (
          <div className="biblioteka-card biblioteka-content-card" style={contentCardStyle} ref={contentCardRef}>
            <div className="biblioteka-content-header">
              <div className="biblioteka-content-heading">
                <div className="biblioteka-eyebrow">{translation.author}</div>
                <h1 className="chapterhead">{activeChapterTitle}</h1>
                <div className="biblioteka-content-meta">
                  <span className="biblioteka-content-pill">{chapterProgressLabel}</span>
                  <span className="biblioteka-content-pill">{chapterProgressPercent}% knjige</span>
                </div>
                {!contentLoading && !contentError ? (
                  <div className="biblioteka-content-ambience">
                    <div className="biblioteka-content-stat">
                      <span>Tempo</span>
                      <strong>{chapterReadingStats.readingMinutes} min čitanja</strong>
                    </div>
                    <div className="biblioteka-content-stat">
                      <span>Obim</span>
                      <strong>{formattedChapterWordCount} reči</strong>
                    </div>
                    <div className="biblioteka-content-progress-inline">
                      <div className="biblioteka-content-progress-track" aria-hidden="true">
                        <span style={{ width: `${Math.round(chapterScrollProgress * 100)}%` }} />
                      </div>
                      <span>{Math.round(chapterScrollProgress * 100)}% poglavlja</span>
                    </div>
                    <div className="biblioteka-text-size-control" aria-label="Veličina teksta">
                      <span>Tekst</span>
                      <div className="biblioteka-text-size-buttons" role="group" aria-label="Podešavanje veličine teksta">
                        <button
                          type="button"
                          className="biblioteka-text-size-button"
                          onClick={() => handleAdjustReaderTextScale('decrease')}
                          disabled={isReaderTextScaleMin}
                          aria-label="Smanji tekst"
                        >
                          −
                        </button>
                        <strong>{readerTextScalePercent}</strong>
                        <button
                          type="button"
                          className="biblioteka-text-size-button"
                          onClick={() => handleAdjustReaderTextScale('increase')}
                          disabled={isReaderTextScaleMax}
                          aria-label="Povećaj tekst"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="biblioteka-chapter-nav">
                <button onClick={() => navigateTo(language, activeBookId, Math.max(0, chapterIndex - 1))} disabled={chapterIndex === 0} aria-label="Prethodno poglavlje">
                  <span className="biblioteka-chapter-nav-direction">←</span>
                  <span className="biblioteka-chapter-nav-copy">
                    <small>Prethodno</small>
                    <strong>{previousChapter?.title ?? 'Početak knjige'}</strong>
                  </span>
                </button>
                <button
                  onClick={() => navigateTo(language, activeBookId, Math.min(translation.chapters.length - 1, chapterIndex + 1))}
                  disabled={chapterIndex === translation.chapters.length - 1}
                  aria-label="Sledeće poglavlje"
                >
                  <span className="biblioteka-chapter-nav-copy align-end">
                    <small>Sledeće</small>
                    <strong>{nextChapter?.title ?? 'Kraj knjige'}</strong>
                  </span>
                  <span className="biblioteka-chapter-nav-direction">→</span>
                </button>
              </div>
            </div>

            {contentLoading ? (
              <div className="biblioteka-placeholder-text">Učitavam sadržaj knjige…</div>
            ) : contentError ? (
              <div className="biblioteka-language-notice">{contentError}</div>
            ) : (
              <>
                <div className="reader-book-html biblioteka-book-html" dangerouslySetInnerHTML={{ __html: activeChapter?.html ?? '' }} />

                <div className="biblioteka-content-footer-nav">
                  <button
                    type="button"
                    className="biblioteka-content-footer-link"
                    onClick={() => navigateTo(language, activeBookId, Math.max(0, chapterIndex - 1))}
                    disabled={chapterIndex === 0}
                  >
                    <span className="biblioteka-content-footer-label">Prethodno poglavlje</span>
                    <strong>{previousChapter?.title ?? 'Na početku si knjige'}</strong>
                  </button>

                  <button
                    type="button"
                    className="biblioteka-content-footer-link align-end"
                    onClick={() => navigateTo(language, activeBookId, Math.min(translation.chapters.length - 1, chapterIndex + 1))}
                    disabled={chapterIndex === translation.chapters.length - 1}
                  >
                    <span className="biblioteka-content-footer-label">Sledeće poglavlje</span>
                    <strong>{nextChapter?.title ?? 'Stigao/la si do kraja knjige'}</strong>
                  </button>
                </div>
              </>
            )}
          </div>
          ) : null}
        </section>
      </main>
      ) : null}

      {showReadingAssistant ? (
        <div className="biblioteka-reading-assistant">
          <button type="button" className="biblioteka-reading-assistant-button" onClick={handleScrollToChapterTop}>
            <span className="biblioteka-reading-assistant-icon">↑</span>
            <span className="biblioteka-reading-assistant-copy">
              <small>Povratak</small>
              <strong>Na vrh poglavlja</strong>
            </span>
          </button>

          {nextChapter ? (
            <button
              type="button"
              className="biblioteka-reading-assistant-button accent"
              onClick={() => navigateTo(language, activeBookId, Math.min(translation.chapters.length - 1, chapterIndex + 1))}
            >
              <span className="biblioteka-reading-assistant-copy align-end">
                <small>Sledeći korak</small>
                <strong>{nextChapter.title}</strong>
              </span>
              <span className="biblioteka-reading-assistant-icon">→</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <footer className="biblioteka-footer">
        <div className="biblioteka-footer-inner">
          <div className="biblioteka-footer-copy">Autorska prava © EGV Biblioteka. Sva prava su zadržana.</div>
          {formattedVisitorTotal || visitorInsight.country ? (
            <div className="biblioteka-footer-meta" aria-label="Uvid u posete aplikaciji">
              {formattedVisitorTotal ? <span>Posetioci: {formattedVisitorTotal}</span> : null}
              {visitorInsight.country ? <span>Trenutna poseta iz: {visitorInsight.country}</span> : null}
            </div>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
