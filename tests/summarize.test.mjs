import { heuristicSummary } from '../src/lib/summarize.js';

let pass = 0;
let fail = 0;

function ok(cond, label, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${label}${detail ? `\n  ${detail}` : ''}`); }
}

function rating(cls, date, comment, clarity = 3, helpful = 3, diff = 3) {
  return { class: cls, date, comment, clarityRating: clarity, helpfulRating: helpful, difficultyRating: diff };
}

/* ---- plural matching (the 'exams' vs 'exam' bug) ---- */
{
  const s = heuristicSummary({
    avgRating: 2.5, avgDifficulty: 4, numRatings: 6, wouldTakeAgainPercent: 30, tags: [],
    ratings: [
      rating('CS1', '2024-01-01', 'The exams are brutal and completely unfair.'),
      rating('CS1', '2024-02-01', 'Exams do not match the lectures at all.'),
      rating('CS1', '2024-03-01', 'Tests are impossible and the quizzes are worse.'),
      rating('CS1', '2024-04-01', 'The exams are the worst part of this class.'),
    ],
  });
  const exams = s.aspects.find((a) => a.label === 'Exams');
  ok(exams, 'plural: Exams aspect detected at all');
  ok(exams && exams.mentions >= 4, 'plural: all four exam sentences counted',
     exams ? `mentions=${exams.mentions}` : '');
  ok(exams && exams.sentiment === 'negative', 'plural: exams read as negative');
}

/* ---- quotes must be verbatim, not the normalized analysis text ---- */
{
  const s = heuristicSummary({
    avgRating: 4, avgDifficulty: 3, numRatings: 8, wouldTakeAgainPercent: 80, tags: [],
    ratings: [
      rating('CS1', '2024-01-01', 'He is incredibly helpful in office hours and very responsive.'),
      rating('CS1', '2024-02-01', 'Office hours are great, he is approachable and kind.'),
      rating('CS1', '2024-03-01', 'Very available over email and helpful in office hours.'),
    ],
  });
  const blob = JSON.stringify(s);
  ok(!blob.includes('officehours'), 'verbatim: internal token does not leak into output');
  ok(blob.includes('office hours'), 'verbatim: original phrasing preserved');
}

/* ---- no sentence quoted under two aspects ---- */
{
  const s = heuristicSummary({
    avgRating: 3, avgDifficulty: 3, numRatings: 10, wouldTakeAgainPercent: 50, tags: [],
    ratings: [
      rating('CS1', '2024-01-01', 'Clear lectures and very helpful grading feedback on homework.'),
      rating('CS1', '2024-02-01', 'The lectures are clear and grading is fair on assignments.'),
      rating('CS1', '2024-03-01', 'Clear explanations, fair grading, reasonable homework.'),
      rating('CS1', '2024-04-01', 'Lectures are organized and the grading rubric is clear.'),
    ],
  });
  const quotes = s.aspects.map((a) => a.quote).filter(Boolean);
  ok(new Set(quotes).size === quotes.length, 'dedup: each aspect quotes a different sentence',
     JSON.stringify(quotes));
}

/* ---- negation ---- */
{
  const s = heuristicSummary({
    avgRating: 2, avgDifficulty: 4, numRatings: 8, wouldTakeAgainPercent: 20, tags: [],
    ratings: [
      rating('CS1', '2024-01-01', 'The lectures are not clear and not helpful at all.'),
      rating('CS1', '2024-02-01', 'His lectures are never organized and not engaging.'),
      rating('CS1', '2024-03-01', 'Lectures are not good, I could not follow anything.'),
    ],
  });
  const lect = s.aspects.find((a) => a.label === 'Lectures');
  ok(lect && lect.sentiment !== 'positive', 'negation: "not clear" is not read as praise',
     lect ? `sentiment=${lect.sentiment}` : 'no lectures aspect');
}

/* ---- per-course split ---- */
{
  const s = heuristicSummary({
    avgRating: 3.1, avgDifficulty: 4, numRatings: 12, wouldTakeAgainPercent: 44, tags: [],
    ratings: [
      rating('CS1550', '2024-01-01', 'Exams are brutal here.', 2, 2, 5),
      rating('CS1550', '2024-02-01', 'Very hard course, unfair grading.', 2, 2, 5),
      rating('CS1550', '2024-03-01', 'Tough class, confusing material.', 2, 3, 5),
      rating('CS0401', '2024-01-01', 'Great intro class, very clear.', 5, 5, 2),
      rating('CS0401', '2024-02-01', 'Loved it, he explains well.', 5, 5, 2),
      rating('CS0401', '2024-03-01', 'Excellent and approachable.', 5, 5, 2),
    ],
  });
  ok(s.courses.length === 2, 'courses: both courses reported', JSON.stringify(s.courses));
  const hard = s.courses.find((c) => c.code === 'CS1550');
  const easy = s.courses.find((c) => c.code === 'CS0401');
  ok(hard && easy && easy.avg > hard.avg, 'courses: intro course scores higher than the hard one',
     `CS0401=${easy?.avg} CS1550=${hard?.avg}`);
  ok(hard && hard.difficulty > easy.difficulty, 'courses: difficulty differs correctly');
}

/* ---- trend needs both a gap and a real span ---- */
{
  const old = Array.from({ length: 6 }, (_, i) =>
    rating('CS1', `2020-0${i + 1}-01`, 'Confusing and disorganized lectures.', 1, 1, 5));
  const recent = Array.from({ length: 6 }, (_, i) =>
    rating('CS1', `2025-0${i + 1}-01`, 'Very clear and helpful now, much improved.', 5, 5, 3));
  const s = heuristicSummary({
    avgRating: 3, avgDifficulty: 4, numRatings: 12, wouldTakeAgainPercent: 50, tags: [],
    ratings: [...old, ...recent],
  });
  ok(s.trend && /better/.test(s.trend), 'trend: improvement detected', String(s.trend));

  const flat = heuristicSummary({
    avgRating: 3, avgDifficulty: 3, numRatings: 10, wouldTakeAgainPercent: 50, tags: [],
    ratings: Array.from({ length: 10 }, (_, i) =>
      rating('CS1', `2024-0${(i % 9) + 1}-01`, 'It was a fine class overall.', 3, 3, 3)),
  });
  ok(!flat.trend, 'trend: no false positive on flat ratings', String(flat.trend));
}

/* ---- thin data degrades honestly ---- */
{
  const s = heuristicSummary({
    avgRating: 3.0, avgDifficulty: null, numRatings: 2, wouldTakeAgainPercent: null,
    tags: [], ratings: [rating('CS1', '2024-01-01', 'It was fine.')],
  });
  ok(/anecdotal|Too few/.test(s.headline), 'thin: headline flags low confidence', s.headline);
  ok(s.courses.length === 0, 'thin: no course breakdown from one review');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
