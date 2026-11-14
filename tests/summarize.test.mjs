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

/* ---- negation: the other contractions ---- */
{
  const s = heuristicSummary({
    avgRating: 2.1, avgDifficulty: 4, numRatings: 10, wouldTakeAgainPercent: 20, tags: [],
    ratings: [
      rating('CS1', '2024-01-01', "I wouldn't recommend his lectures to anyone."),
      rating('CS1', '2024-02-01', "His lectures aren't clear or helpful at all."),
      rating('CS1', '2024-03-01', "The lectures weren't engaging and I couldn't follow them."),
      rating('CS1', '2024-04-01', "Don't expect his lectures to be organized."),
    ],
  });
  const lect = s.aspects.find((a) => a.label === 'Lectures');
  ok(lect && lect.sentiment === 'negative', 'negation: aren\'t, weren\'t, wouldn\'t and don\'t',
     lect ? `sentiment=${lect.sentiment}` : 'no lectures aspect');
}

/* ---- negation typed with a phone's curly apostrophe ---- */
{
  const s = heuristicSummary({
    avgRating: 2.1, avgDifficulty: 4, numRatings: 10, wouldTakeAgainPercent: 20, tags: [],
    ratings: [
      rating('CS1', '2024-01-01', 'He wasn’t clear in lecture and didn’t seem organized.'),
      rating('CS1', '2024-02-01', 'The lectures aren’t engaging and I couldn’t follow them.'),
      rating('CS1', '2024-03-01', 'His lectures weren’t helpful and he isn’t clear either.'),
    ],
  });
  const lect = s.aspects.find((a) => a.label === 'Lectures');
  ok(lect && lect.sentiment === 'negative', 'negation: curly apostrophes',
     lect ? `sentiment=${lect.sentiment}` : 'no lectures aspect');
  const quotes = s.aspects.map((a) => a.quote).filter(Boolean);
  ok(quotes.length && quotes.every((q) => q.includes('’')), 'negation: quotes keep the curly apostrophe',
     JSON.stringify(quotes));
}

/* ---- "hard to understand" is not "understanding" ---- */
{
  const s = heuristicSummary({
    avgRating: 2.5, avgDifficulty: 4, numRatings: 10, wouldTakeAgainPercent: 30, tags: [],
    ratings: [
      rating('CS1', '2024-01-01', 'Nice guy but his lectures are really hard to understand.'),
      rating('CS1', '2024-02-01', 'The material is hard to understand and he moves fast.'),
      rating('CS1', '2024-03-01', 'His explanations are hard to understand most days.'),
    ],
  });
  const positive = s.aspects.filter((a) => a.sentiment === 'positive').map((a) => a.label);
  ok(positive.length === 0, 'phrases: "hard to understand" is not praise', JSON.stringify(positive));
}

/* ---- headline verb agrees with a singular label ---- */
{
  const s = heuristicSummary({
    avgRating: 3.6, avgDifficulty: 3, numRatings: 18, wouldTakeAgainPercent: 61, tags: [],
    ratings: [
      rating('CS1', '2024-01-01', 'The grading is fair and generous with partial credit.'),
      rating('CS1', '2024-02-01', 'Grading is clear and fair, the rubric helps a lot.'),
      rating('CS1', '2024-03-01', 'Very fair grading on every assignment I turned in.'),
      rating('CS1', '2024-04-01', 'The workload is brutal and the homework is tedious.'),
      rating('CS1', '2024-05-01', 'Homework takes forever and the workload is overwhelming.'),
      rating('CS1', '2024-06-01', 'Terrible workload, the readings are pointless.'),
    ],
  });
  ok(s.headline.endsWith('Grading draws praise, workload draws complaints.'), 'headline: singular labels take "draws"',
     s.headline);
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

/* ---- one course written two ways is one line (both pairs are from real panels) ---- */
{
  const many = (cls, n, clarity) =>
    Array.from({ length: n }, (_, i) => rating(cls, `2024-0${(i % 9) + 1}-01`, 'It was a fine class overall.', clarity, clarity, 3));
  const courses = (ratings) =>
    heuristicSummary({ avgRating: 4, avgDifficulty: 3, numRatings: 20, wouldTakeAgainPercent: 80, tags: [], ratings }).courses;
  const lines = (list) => list.map((c) => `${c.code} x${c.count}`).join(', ');

  const bare = courses([...many('CS0445', 8, 5), ...many('0445', 5, 3), ...many('CS0401', 3, 4)]);
  ok(lines(bare) === 'CS0445 x13, CS0401 x3', 'courses: a bare number joins the one lettered code with that number', lines(bare));
  ok(bare[0]?.avg === 4.2, 'courses: the joined line averages both spellings', String(bare[0]?.avg));

  const padded = courses([...many('CMPINF0401', 7, 4), ...many('CS007', 4, 3), ...many('CS0007', 4, 4)]);
  ok(lines(padded) === 'CS0007 x8, CMPINF0401 x7', 'courses: CS007 and CS0007 are one course', lines(padded));

  const typed = courses([...many('cs 0445', 2, 4), ...many('CS-0445', 2, 4), ...many('CS0445.', 3, 4), ...many('CS1501', 2, 4)]);
  ok(lines(typed) === 'CS0445 x7, CS1501 x2', 'courses: case, spaces and punctuation do not split a course', lines(typed));

  // Two lettered codes share the number, so the bare one could be either.
  const either = courses([...many('CS0401', 3, 4), ...many('CMPINF0401', 3, 4), ...many('0401', 2, 4)]);
  ok(lines(either) === 'CS0401 x3, CMPINF0401 x3, 0401 x2', 'courses: a bare number with two possible homes stays apart', lines(either));

  const apart = courses([
    ...many('CS0445', 2, 4), ...many('CS1445', 2, 4), ...many('CS1501', 2, 4), ...many('CS1501W', 2, 4), ...many('CS0010', 2, 4),
  ]);
  ok(lines(apart) === 'CS0445 x2, CS1445 x2, CS1501 x2, CS1501W x2, CS0010 x2', 'courses: different numbers and suffixes stay apart', lines(apart));

  const zeros = courses([...many('CS0010', 2, 4), ...many('CS0100', 2, 4), ...many('MATH0010', 2, 4), ...many('1501', 2, 4)]);
  ok(lines(zeros) === 'CS0010 x2, CS0100 x2, MATH0010 x2, 1501 x2', 'courses: CS0010, CS0100, MATH0010 and an unmatched number stay apart', lines(zeros));
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
