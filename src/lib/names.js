/**
 * Instructor name parsing and matching.
 *
 * This is the part that actually decides whether the extension is useful or
 * infuriating, so it is deliberately conservative: when confidence is low we
 * say so rather than showing a confident rating for the wrong person.
 */

const PLACEHOLDERS = new Set([
  'staff', 'tba', 'tbd', 'tba tba', 'to be announced', 'to be determined',
  'not assigned', 'unassigned', 'instructor', 'no instructor', 'none',
  'multiple instructors', 'arranged', 'faculty',
]);

const TITLES = /\b(dr|prof|professor|mr|mrs|ms|miss|sir|rev|hon)\.?\b/gi;
const SUFFIXES = /\b(phd|ph\.d|md|m\.d|jr|sr|ii|iii|iv|esq|dds|jd|mba|ma|ms|msc|bs|ba)\.?\b/gi;

// Surname particles that belong to the last name, not the middle name.
const PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'della', 'di', 'da', 'dos', 'das', 'du',
  'la', 'le', 'las', 'los', 'mc', 'mac', 'st', 'st.', 'saint', 'bin',
  'ibn', 'al', 'el', 'ter', 'ten', 'op', 'vander', 'vande',
  'der', 'den', 'dell', 'delle', 'do', 'ver', 'zu', 'af', 'av',
]);

// Common given-name shortenings. Not exhaustive; covers the frequent cases
// where PeopleSoft has the legal name and RMP has what students call them.
const NICKNAMES = {
  robert: ['bob', 'rob', 'bobby'], william: ['bill', 'will', 'billy'],
  michael: ['mike', 'mick'], james: ['jim', 'jimmy'], david: ['dave'],
  stephen: ['steve'], steven: ['steve'], thomas: ['tom', 'tommy'],
  daniel: ['dan', 'danny'], matthew: ['matt'], christopher: ['chris'],
  nicholas: ['nick'], alexander: ['alex'], benjamin: ['ben'],
  samuel: ['sam'], joseph: ['joe', 'joey'], anthony: ['tony'],
  richard: ['rick', 'dick', 'rich'], kenneth: ['ken'], theodore: ['ted'],
  andrew: ['andy', 'drew'], gregory: ['greg'], jeffrey: ['jeff'],
  edward: ['ed', 'eddie'], patrick: ['pat'], vincent: ['vince'],
  catherine: ['cathy', 'kate', 'katie'], katherine: ['kate', 'katie', 'kathy'],
  elizabeth: ['liz', 'beth', 'lizzy'], susan: ['sue'], jennifer: ['jen', 'jenny'],
  deborah: ['deb', 'debbie'], rebecca: ['becky'], margaret: ['maggie', 'peggy'],
  patricia: ['pat', 'patty', 'tricia'], barbara: ['barb'], victoria: ['vicky'],
  charles: ['charlie', 'chuck'], lawrence: ['larry'], ronald: ['ron'],
  donald: ['don'], timothy: ['tim'], zachary: ['zach'], nathaniel: ['nate'],
  jonathan: ['jon'], frederick: ['fred'], raymond: ['ray'], eugene: ['gene'],
};

const NICK_TO_FULL = (() => {
  const m = new Map();
  for (const [full, nicks] of Object.entries(NICKNAMES)) {
    for (const n of nicks) {
      if (!m.has(n)) m.set(n, []);
      m.get(n).push(full);
    }
  }
  return m;
})();

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9\s',.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTitles(s) {
  return s.replace(TITLES, ' ').replace(SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
}

export function isPlaceholder(raw) {
  const n = normalize(raw).replace(/[.,]/g, '').trim();
  if (!n) return true;
  if (PLACEHOLDERS.has(n)) return true;
  // Things like "Staff, Staff" or "TBA - TBA"
  const parts = n.split(/[\s,-]+/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => PLACEHOLDERS.has(p));
}

/* ------------------------------------------------------------------ */
/* Splitting a cell that may hold several instructors                  */
/* ------------------------------------------------------------------ */

/**
 * Turn one raw instructor string into a list of individual name strings.
 * Handles: "Smith, John", "Smith, John; Doe, Jane", "John Smith and Jane Doe",
 * "Smith, John, Doe, Jane", "Smith,John/Doe,Jane".
 */
export function splitInstructors(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];

  // Hard separators first -- these are unambiguous.
  const hard = s.split(/\s*[;|/]\s*|\s+&\s+|\s+\band\b\s+/i).map((x) => x.trim()).filter(Boolean);
  if (hard.length > 1) return hard.flatMap(splitInstructors);

  const commas = s.split(',').map((x) => x.trim()).filter(Boolean);

  if (commas.length <= 1) return [s];

  if (commas.length === 2) {
    const p1Words = commas[0].split(/\s+/).filter(Boolean);
    const p2Words = commas[1].split(/\s+/).filter(Boolean);

    // "Smith, John" / "Smith, John A": single word before the comma is a
    // surname, so this is one person in Last-First form.
    if (p1Words.length === 1 && p2Words.length <= 3) return [s];

    // "van der Berg, Anna": multi-word before the comma, but everything after
    // the first word is a surname particle -- still one surname, one person.
    const trailing = p1Words.slice(1).map((w) => w.toLowerCase());
    if (trailing.length && trailing.every((w) => PARTICLES.has(w))) {
      if (p2Words.length <= 3) return [s];
    }

    // "Jamie Torres Rivera, Kendon Freeman": both sides are complete
    // multi-word names, so the comma separates two people.
    if (p1Words.length >= 2 && p2Words.length >= 2) {
      return [commas[0], commas[1]];
    }

    // "Torres Rivera, Kendon": multi-word surname in Last-First form.
    return [s];
  }

  // Even number of comma parts where each is short -> likely paired
  // "Last1, First1, Last2, First2".
  if (commas.length % 2 === 0 && commas.every((c) => c.split(/\s+/).length <= 3)) {
    const out = [];
    for (let i = 0; i < commas.length; i += 2) {
      out.push(`${commas[i]}, ${commas[i + 1]}`);
    }
    return out;
  }

  // Fallback: treat each comma part as its own person.
  return commas;
}

/* ------------------------------------------------------------------ */
/* Parsing one name                                                    */
/* ------------------------------------------------------------------ */

/**
 * @returns {{first: string, middle: string, last: string, display: string} | null}
 */
export function parseName(raw) {
  const display = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!display || isPlaceholder(display)) return null;

  let s = stripTitles(normalize(display));
  if (!s) return null;

  let first = '';
  let middle = '';
  let last = '';

  if (s.includes(',')) {
    // "last, first middle"
    const [lastPart, ...restParts] = s.split(',');
    last = lastPart.trim();
    const rest = restParts.join(' ').trim().split(/\s+/).filter(Boolean);
    first = rest[0] || '';
    middle = rest.slice(1).join(' ');
  } else {
    const tokens = s.split(/\s+/).filter(Boolean);
    if (tokens.length === 1) {
      last = tokens[0];
    } else {
      first = tokens[0];
      // Absorb surname particles into the last name.
      let lastStart = tokens.length - 1;
      while (lastStart - 1 > 0 && PARTICLES.has(tokens[lastStart - 1])) {
        lastStart -= 1;
      }
      last = tokens.slice(lastStart).join(' ');
      middle = tokens.slice(1, lastStart).join(' ');
    }
  }

  first = first.replace(/[.,]/g, '').trim();
  last = last.replace(/[.]/g, '').trim();
  middle = middle.replace(/[.,]/g, '').trim();

  if (!last) return null;
  return { first, middle, last, display };
}

/* ------------------------------------------------------------------ */
/* Fuzzy comparison                                                    */
/* ------------------------------------------------------------------ */

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function firstNameAffinity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 50;

  // Single initial on either side.
  if (a.length === 1 || b.length === 1) {
    return a[0] === b[0] ? 22 : -10;
  }

  // Prefix: "Chris" vs "Christopher".
  if (a.startsWith(b) || b.startsWith(a)) return 34;

  // Known nickname pair.
  const aFulls = NICK_TO_FULL.get(a) || [];
  const bFulls = NICK_TO_FULL.get(b) || [];
  if (aFulls.includes(b) || bFulls.includes(a)) return 34;
  if (aFulls.some((f) => bFulls.includes(f))) return 30;

  const d = levenshtein(a, b);
  if (d === 1 && Math.min(a.length, b.length) >= 4) return 24;
  if (d === 2 && Math.min(a.length, b.length) >= 7) return 12;

  return -18; // Different first names is real evidence against a match.
}

/**
 * Score one RMP teacher node against a parsed name.
 * Returns null if the last name is too far off to consider.
 */
export function scoreCandidate(parsed, node) {
  const nodeLast = normalize(node.lastName);
  const nodeFirst = normalize(node.firstName).split(/\s+/)[0] || '';

  if (!nodeLast) return null;

  let score = 0;
  const lastDist = levenshtein(parsed.last, nodeLast);

  if (lastDist === 0) {
    score += 100;
  } else if (lastDist === 1 && Math.max(parsed.last.length, nodeLast.length) >= 5) {
    score += 62;
  } else if (lastDist === 2 && Math.max(parsed.last.length, nodeLast.length) >= 8) {
    score += 34;
  } else if (parsed.last.includes(nodeLast) || nodeLast.includes(parsed.last)) {
    // Hyphenated or partially recorded surnames.
    score += 48;
  } else {
    return null;
  }

  score += firstNameAffinity(parsed.first, nodeFirst);

  // Prefer professors with a real sample size, but only as a tiebreak.
  score += Math.min(node.numRatings || 0, 30) * 0.35;

  return score;
}

const ACCEPT_THRESHOLD = 118;
const AMBIGUITY_MARGIN = 12;

/**
 * Pick the best RMP teacher for a parsed name.
 * @returns {{node: object, score: number, confidence: 'high'|'low', alternatives: object[]} | null}
 */
export function pickBest(parsed, nodes) {
  const scored = [];
  for (const node of nodes || []) {
    const score = scoreCandidate(parsed, node);
    if (score !== null) scored.push({ node, score });
  }
  if (!scored.length) return null;

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1];

  if (best.score < ACCEPT_THRESHOLD) return null;

  const ambiguous = runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN;

  return {
    node: best.node,
    score: Math.round(best.score),
    confidence: ambiguous ? 'low' : 'high',
    alternatives: scored.slice(1, 4).map((s) => s.node),
  };
}

/** Stable cache key for a parsed name. */
export function cacheKey(parsed, schoolID) {
  return `${schoolID}|${parsed.last}|${parsed.first.slice(0, 1)}`;
}

/** Query string to send to RMP search. Last name alone recalls best. */
export function searchTerm(parsed) {
  return parsed.first ? `${parsed.first} ${parsed.last}` : parsed.last;
}

/**
 * The base institution name, with any campus suffix removed.
 * "University of Pittsburgh - Greensburg" -> "university of pittsburgh".
 * RMP lists regional campuses as separate schools, so lookups must span the
 * whole family or professors at branch campuses are invisible.
 */
export function familyBase(name) {
  return normalize(String(name || '').split(/\s*[-–—]\s*|\s+at\s+/i)[0]);
}

/* ------------------------------------------------------------------ */
/* Person-name validation                                              */
/* ------------------------------------------------------------------ */

// Vocabulary that appears in class-search cells but never in a person's name.
const NON_NAME_TOKENS = new Set([
  'fall', 'spring', 'summer', 'winter', 'term', 'session', 'semester',
  'campus', 'hall', 'building', 'center', 'centre', 'room', 'library',
  'online', 'web', 'based', 'hybrid', 'remote', 'in-person', 'zoom',
  'lecture', 'lec', 'lab', 'clb', 'rec', 'seminar', 'sem', 'workshop',
  'studio', 'clinic', 'practicum', 'independent', 'directed', 'study',
  'credits', 'credit', 'units', 'unit', 'open', 'closed', 'waitlist',
  'principles', 'introduction', 'intro', 'advanced', 'intermediate',
  'general', 'special', 'topics', 'honors', 'capstone', 'thesis',
  'undergraduate', 'graduate', 'career', 'academic', 'catalog',
  'am', 'pm', 'tba', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'science', 'engineering', 'accounting',
  'management', 'view', 'sections', 'search', 'offered', 'typically',
]);

// PeopleSoft day strings: "MoWeFr", "TuTh", "Mo", etc.
const DAY_PATTERN = /^(mo|tu|we|th|fr|sa|su){1,7}$/i;

/**
 * Whether a string plausibly names a human. This is the gate between
 * detection and lookup: anything failing it gets no badge and no request.
 * Names like "DeDiana" or "van der Berg" must pass; "MoWeFr", "AT",
 * "124 Biddle Hall", and "MANAGERIAL ACCOUNTING" must not.
 */
export function looksLikePersonName(raw) {
  const display = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!display || display.length < 3 || display.length > 60) return false;
  if (/\d/.test(display)) return false;               // times, rooms, codes
  if (/[/@#$%^&*()+=\[\]{}<>|~]/.test(display)) return false;

  // Course titles and headers render in ALL CAPS; names render in title case.
  const letters = display.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) return false;

  const tokens = display.split(/[\s,]+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 5) return false;

  let capitalized = 0;
  for (const tok of tokens) {
    const t = tok.replace(/[.,'-]/g, '');
    if (!t) continue;
    const low = t.toLowerCase();
    if (NON_NAME_TOKENS.has(low)) return false;
    if (/^[A-Z]/.test(t)) capitalized += 1;
  }

  // Day strings ("MoWeFr", "TuTh") always appear alone in their cell. Only
  // reject the pattern for standalone tokens so surnames like Tutu survive
  // when a first name accompanies them.
  if (tokens.length === 1 && DAY_PATTERN.test(tokens[0].replace(/[.,]/g, ''))) return false;

  // Names capitalize; surname particles (van, der, de) may not, so require
  // most tokens capitalized rather than all.
  if (capitalized === 0) return false;

  // A single token must look like a standalone surname, not a stray word.
  if (tokens.length === 1) {
    const t = tokens[0].replace(/[.,]/g, '');
    if (t.length < 3) return false;
    if (!/^[A-Z][a-z']+([A-Z][a-z']+)?(-[A-Z][a-z']+)?$/.test(t)) return false;
  }

  return true;
}
