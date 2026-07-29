/**
 * RateMyProfessors GraphQL client.
 *
 * RMP has no public/documented API. This talks to the same GraphQL endpoint
 * their own web client uses. The Authorization header below is the anonymous
 * credential their public site ships in its JS bundle -- it is not a secret and
 * not tied to any account. If RMP changes it, the fix is to open
 * ratemyprofessors.com, watch the Network tab for a /graphql request, and copy
 * the new Authorization value here.
 */

const RMP_ENDPOINT = 'https://www.ratemyprofessors.com/graphql';
const RMP_AUTH = 'Basic dGVzdDp0ZXN0'; // base64("test:test")

async function gql(query, variables) {
  const res = await fetch(RMP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: RMP_AUTH,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`RMP responded ${res.status}`);
  }

  const json = await res.json();
  if (json.errors && json.errors.length) {
    const err = new Error(json.errors.map((e) => e.message).join('; '));
    err.graphQLErrors = json.errors;
    throw err;
  }
  return json.data;
}

/* ------------------------------------------------------------------ */
/* School lookup                                                       */
/* ------------------------------------------------------------------ */

const SCHOOL_QUERY = `
  query SearchSchool($text: String!) {
    newSearch {
      schools(query: { text: $text }) {
        edges {
          node { id name city state numRatings }
        }
      }
    }
  }
`;

export async function searchSchools(text) {
  const data = await gql(SCHOOL_QUERY, { text });
  const edges = data?.newSearch?.schools?.edges || [];
  return edges.map((e) => e.node).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Teacher search                                                      */
/* ------------------------------------------------------------------ */

const TEACHER_SEARCH_QUERY = `
  query SearchTeacher($text: String!, $schoolID: ID!) {
    newSearch {
      teachers(query: { text: $text, schoolID: $schoolID }) {
        edges {
          node {
            id
            legacyId
            firstName
            lastName
            department
            avgRating
            avgDifficulty
            numRatings
            wouldTakeAgainPercent
            school { id name }
          }
        }
      }
    }
  }
`;

export async function searchTeachers(text, schoolID) {
  const data = await gql(TEACHER_SEARCH_QUERY, { text, schoolID });
  const edges = data?.newSearch?.teachers?.edges || [];
  return edges.map((e) => e.node).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Teacher detail (+ comments)                                         */
/* ------------------------------------------------------------------ */

// Full query. If RMP renames a field this throws, and we fall back below.
const TEACHER_DETAIL_FULL = `
  query GetTeacher($id: ID!, $count: Int!) {
    node(id: $id) {
      ... on Teacher {
        id
        legacyId
        firstName
        lastName
        department
        avgRating
        avgDifficulty
        numRatings
        wouldTakeAgainPercent
        teacherRatingTags { tagName tagCount }
        ratings(first: $count) {
          edges {
            node {
              class
              date
              comment
              clarityRating
              difficultyRating
              helpfulRating
              wouldTakeAgain
              grade
              isForOnlineClass
              ratingTags
            }
          }
        }
      }
    }
  }
`;

// Minimal query -- only fields that have been stable for years.
const TEACHER_DETAIL_MINIMAL = `
  query GetTeacher($id: ID!, $count: Int!) {
    node(id: $id) {
      ... on Teacher {
        id
        legacyId
        firstName
        lastName
        department
        avgRating
        avgDifficulty
        numRatings
        wouldTakeAgainPercent
        ratings(first: $count) {
          edges {
            node { class date comment difficultyRating }
          }
        }
      }
    }
  }
`;

export async function getTeacher(id, count = 20) {
  let data;
  try {
    data = await gql(TEACHER_DETAIL_FULL, { id, count });
  } catch (err) {
    // Field-level schema drift is the most likely failure. Retry lean.
    console.warn('[RMP] full detail query failed, retrying minimal:', err.message);
    data = await gql(TEACHER_DETAIL_MINIMAL, { id, count });
  }

  const node = data?.node;
  if (!node) return null;

  const ratings = (node.ratings?.edges || [])
    .map((e) => e.node)
    .filter((r) => r && typeof r.comment === 'string' && r.comment.trim().length > 0);

  return {
    id: node.id,
    legacyId: node.legacyId,
    firstName: node.firstName,
    lastName: node.lastName,
    department: node.department,
    avgRating: normalizeNum(node.avgRating),
    avgDifficulty: normalizeNum(node.avgDifficulty),
    numRatings: node.numRatings ?? 0,
    wouldTakeAgainPercent: normalizeWta(node.wouldTakeAgainPercent),
    tags: (node.teacherRatingTags || [])
      .slice()
      .sort((a, b) => (b.tagCount || 0) - (a.tagCount || 0))
      .slice(0, 6)
      .map((t) => ({ name: t.tagName, count: t.tagCount })),
    ratings,
    url: `https://www.ratemyprofessors.com/professor/${node.legacyId}`,
  };
}

// RMP uses -1 as "no data" for several numeric fields.
function normalizeNum(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeWta(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}
