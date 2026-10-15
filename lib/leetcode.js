// LeetCode GraphQL client. Runs in the background page, which has host access to
// leetcode.com, so the user's logged-in cookies ride along with each request.
(function (root) {
  const ENDPOINT = "https://leetcode.com/graphql/";

  async function csrfToken() {
    try {
      const c = await browser.cookies.get({ url: "https://leetcode.com", name: "csrftoken" });
      return c ? c.value : "";
    } catch {
      return "";
    }
  }

  async function gql(query, variables = {}) {
    const headers = { "Content-Type": "application/json" };
    const csrf = await csrfToken();
    if (csrf) headers["x-csrftoken"] = csrf;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`LeetCode returned HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors && !json.data) throw new Error(json.errors.map((e) => e.message).join("; "));
    return json.data;
  }

  async function currentUser() {
    const data = await gql(`query { userStatus { username isSignedIn } }`);
    const s = data && data.userStatus;
    return s && s.isSignedIn ? s.username : "";
  }

  async function recentAccepted(username, limit = 20) {
    const data = await gql(
      `query recentAc($username: String!, $limit: Int!) {
        recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp }
      }`,
      { username, limit }
    );
    return (data && data.recentAcSubmissionList) || [];
  }

  // Returns { tagSlug: problemsSolved } plus solved counts by difficulty.
  async function skillProfile(username) {
    const data = await gql(
      `query skills($username: String!) {
        matchedUser(username: $username) {
          tagProblemCounts {
            advanced { tagSlug problemsSolved }
            intermediate { tagSlug problemsSolved }
            fundamental { tagSlug problemsSolved }
          }
          submitStatsGlobal { acSubmissionNum { difficulty count } }
        }
      }`,
      { username }
    );
    const u = data && data.matchedUser;
    if (!u) throw new Error(`LeetCode user "${username}" not found`);
    const tagCounts = {};
    for (const level of ["advanced", "intermediate", "fundamental"]) {
      for (const t of u.tagProblemCounts[level] || []) tagCounts[t.tagSlug] = t.problemsSolved;
    }
    const byDifficulty = {};
    for (const r of (u.submitStatsGlobal && u.submitStatsGlobal.acSubmissionNum) || []) byDifficulty[r.difficulty] = r.count;
    return { tagCounts, byDifficulty };
  }

  async function question(titleSlug) {
    const data = await gql(
      `query q($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionFrontendId title titleSlug difficulty content status
          topicTags { name slug }
        }
      }`,
      { titleSlug }
    );
    return data && data.question;
  }

  const api = { gql, currentUser, recentAccepted, skillProfile, question };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LeetCode = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
