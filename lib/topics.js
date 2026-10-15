// Core interview topics, the LeetCode tags that map to each one, and a curated
// problem ladder per topic (slug, difficulty). Loaded as a classic script in the
// background page and extension pages, and via require() in tests.
(function (root) {
  const TOPICS = [
    {
      id: "arrays-hashing", name: "Arrays & Hashing", tags: ["array", "hash-table"], target: 60,
      problems: [
        ["contains-duplicate", "Easy"], ["valid-anagram", "Easy"], ["two-sum", "Easy"],
        ["majority-element", "Easy"], ["remove-duplicates-from-sorted-array", "Easy"], ["merge-sorted-array", "Easy"], ["move-zeroes", "Easy"], ["contains-duplicate-ii", "Easy"], ["find-all-numbers-disappeared-in-an-array", "Easy"], ["intersection-of-two-arrays-ii", "Easy"], ["ransom-note", "Easy"], ["isomorphic-strings", "Easy"], ["word-pattern", "Easy"], ["group-anagrams", "Medium"], ["top-k-frequent-elements", "Medium"],
        ["product-of-array-except-self", "Medium"], ["longest-consecutive-sequence", "Medium"],
        ["first-missing-positive", "Hard"]
      ]
    },
    {
      id: "two-pointers", name: "Two Pointers", tags: ["two-pointers"], target: 15,
      problems: [
        ["valid-palindrome", "Easy"], ["is-subsequence", "Easy"], ["reverse-string", "Easy"], ["squares-of-a-sorted-array", "Easy"], ["merge-strings-alternately", "Easy"], ["two-sum-ii-input-array-is-sorted", "Medium"],
        ["3sum", "Medium"], ["container-with-most-water", "Medium"], ["trapping-rain-water", "Hard"]
      ]
    },
    {
      id: "sliding-window", name: "Sliding Window", tags: ["sliding-window"], target: 12,
      problems: [
        ["best-time-to-buy-and-sell-stock", "Easy"],
        ["maximum-average-subarray-i", "Easy"], ["minimum-difference-between-highest-and-lowest-of-k-scores", "Easy"], ["longest-substring-without-repeating-characters", "Medium"],
        ["longest-repeating-character-replacement", "Medium"], ["permutation-in-string", "Medium"],
        ["minimum-window-substring", "Hard"], ["sliding-window-maximum", "Hard"]
      ]
    },
    {
      id: "stack", name: "Stack", tags: ["stack", "monotonic-stack"], target: 12,
      problems: [
        ["valid-parentheses", "Easy"], ["baseball-game", "Easy"], ["implement-queue-using-stacks", "Easy"], ["backspace-string-compare", "Easy"], ["next-greater-element-i", "Easy"], ["min-stack", "Medium"], ["evaluate-reverse-polish-notation", "Medium"],
        ["daily-temperatures", "Medium"], ["car-fleet", "Medium"], ["largest-rectangle-in-histogram", "Hard"]
      ]
    },
    {
      id: "binary-search", name: "Binary Search", tags: ["binary-search"], target: 12,
      problems: [
        ["binary-search", "Easy"], ["search-insert-position", "Easy"], ["first-bad-version", "Easy"], ["sqrtx", "Easy"], ["guess-number-higher-or-lower", "Easy"], ["valid-perfect-square", "Easy"], ["search-a-2d-matrix", "Medium"], ["koko-eating-bananas", "Medium"],
        ["find-minimum-in-rotated-sorted-array", "Medium"], ["search-in-rotated-sorted-array", "Medium"],
        ["median-of-two-sorted-arrays", "Hard"]
      ]
    },
    {
      id: "linked-list", name: "Linked List", tags: ["linked-list"], target: 12,
      problems: [
        ["reverse-linked-list", "Easy"], ["merge-two-sorted-lists", "Easy"], ["linked-list-cycle", "Easy"],
        ["middle-of-the-linked-list", "Easy"], ["palindrome-linked-list", "Easy"], ["remove-linked-list-elements", "Easy"], ["intersection-of-two-linked-lists", "Easy"], ["reorder-list", "Medium"], ["remove-nth-node-from-end-of-list", "Medium"], ["lru-cache", "Medium"],
        ["merge-k-sorted-lists", "Hard"]
      ]
    },
    {
      id: "trees", name: "Trees", tags: ["tree", "binary-tree", "binary-search-tree"], target: 20,
      problems: [
        ["invert-binary-tree", "Easy"], ["maximum-depth-of-binary-tree", "Easy"], ["diameter-of-binary-tree", "Easy"],
        ["same-tree", "Easy"], ["subtree-of-another-tree", "Easy"], ["balanced-binary-tree", "Easy"], ["symmetric-tree", "Easy"], ["path-sum", "Easy"], ["minimum-depth-of-binary-tree", "Easy"], ["convert-sorted-array-to-binary-search-tree", "Easy"], ["lowest-common-ancestor-of-a-binary-search-tree", "Medium"], ["binary-tree-level-order-traversal", "Medium"],
        ["validate-binary-search-tree", "Medium"], ["kth-smallest-element-in-a-bst", "Medium"],
        ["binary-tree-maximum-path-sum", "Hard"], ["serialize-and-deserialize-binary-tree", "Hard"]
      ]
    },
    {
      id: "heap", name: "Heap / Priority Queue", tags: ["heap-priority-queue"], target: 10,
      problems: [
        ["kth-largest-element-in-a-stream", "Easy"], ["last-stone-weight", "Easy"],
        ["relative-ranks", "Easy"], ["k-closest-points-to-origin", "Medium"], ["kth-largest-element-in-an-array", "Medium"],
        ["task-scheduler", "Medium"], ["find-median-from-data-stream", "Hard"]
      ]
    },
    {
      id: "backtracking", name: "Backtracking", tags: ["backtracking"], target: 10,
      problems: [
        ["binary-tree-paths", "Easy"], ["subsets", "Medium"], ["combination-sum", "Medium"], ["permutations", "Medium"],
        ["word-search", "Medium"], ["palindrome-partitioning", "Medium"], ["n-queens", "Hard"]
      ]
    },
    {
      id: "tries", name: "Tries", tags: ["trie"], target: 5,
      problems: [
        ["longest-common-prefix", "Easy"], ["implement-trie-prefix-tree", "Medium"], ["design-add-and-search-words-data-structure", "Medium"],
        ["word-search-ii", "Hard"]
      ]
    },
    {
      id: "graphs", name: "Graphs (BFS/DFS)", tags: ["graph", "breadth-first-search", "depth-first-search", "union-find", "topological-sort"], target: 20,
      problems: [
        ["flood-fill", "Easy"], ["find-if-path-exists-in-graph", "Easy"], ["find-center-of-star-graph", "Easy"], ["island-perimeter", "Easy"], ["number-of-islands", "Medium"], ["clone-graph", "Medium"], ["max-area-of-island", "Medium"],
        ["rotting-oranges", "Medium"], ["pacific-atlantic-water-flow", "Medium"], ["course-schedule", "Medium"],
        ["course-schedule-ii", "Medium"], ["word-ladder", "Hard"]
      ]
    },
    {
      id: "advanced-graphs", name: "Shortest Paths & MST", tags: ["shortest-path", "minimum-spanning-tree"], target: 6,
      problems: [
        ["find-the-town-judge", "Easy"], ["network-delay-time", "Medium"], ["min-cost-to-connect-all-points", "Medium"],
        ["cheapest-flights-within-k-stops", "Medium"], ["swim-in-rising-water", "Hard"], ["reconstruct-itinerary", "Hard"]
      ]
    },
    {
      id: "dp-1d", name: "1-D Dynamic Programming", tags: ["dynamic-programming", "memoization"], target: 25,
      problems: [
        ["climbing-stairs", "Easy"], ["min-cost-climbing-stairs", "Easy"], ["fibonacci-number", "Easy"], ["n-th-tribonacci-number", "Easy"], ["house-robber", "Medium"],
        ["house-robber-ii", "Medium"], ["longest-palindromic-substring", "Medium"], ["decode-ways", "Medium"],
        ["coin-change", "Medium"], ["word-break", "Medium"], ["longest-increasing-subsequence", "Medium"],
        ["partition-equal-subset-sum", "Medium"]
      ]
    },
    {
      id: "dp-2d", name: "2-D Dynamic Programming", tags: ["dynamic-programming"], target: 35,
      problems: [
        ["pascals-triangle", "Easy"], ["pascals-triangle-ii", "Easy"], ["range-sum-query-immutable", "Easy"], ["unique-paths", "Medium"], ["longest-common-subsequence", "Medium"],
        ["best-time-to-buy-and-sell-stock-with-cooldown", "Medium"], ["coin-change-ii", "Medium"],
        ["target-sum", "Medium"], ["edit-distance", "Medium"], ["interleaving-string", "Medium"],
        ["regular-expression-matching", "Hard"], ["burst-balloons", "Hard"]
      ]
    },
    {
      id: "greedy", name: "Greedy", tags: ["greedy"], target: 12,
      problems: [
        ["assign-cookies", "Easy"], ["lemonade-change", "Easy"], ["longest-palindrome", "Easy"], ["maximum-units-on-a-truck", "Easy"], ["maximum-subarray", "Medium"], ["jump-game", "Medium"], ["jump-game-ii", "Medium"],
        ["gas-station", "Medium"], ["hand-of-straights", "Medium"], ["partition-labels", "Medium"],
        ["valid-parenthesis-string", "Medium"]
      ]
    },
    {
      id: "intervals", name: "Intervals", tags: ["line-sweep"], target: 4,
      problems: [
        ["summary-ranges", "Easy"], ["teemo-attacking", "Easy"], ["insert-interval", "Medium"], ["merge-intervals", "Medium"], ["non-overlapping-intervals", "Medium"],
        ["minimum-interval-to-include-each-query", "Hard"]
      ]
    },
    {
      id: "math-bits", name: "Math & Bit Manipulation", tags: ["bit-manipulation", "math", "matrix"], target: 20,
      problems: [
        ["single-number", "Easy"], ["number-of-1-bits", "Easy"], ["counting-bits", "Easy"], ["missing-number", "Easy"],
        ["plus-one", "Easy"], ["happy-number", "Easy"], ["palindrome-number", "Easy"], ["add-binary", "Easy"], ["power-of-two", "Easy"], ["hamming-distance", "Easy"], ["rotate-image", "Medium"], ["spiral-matrix", "Medium"], ["set-matrix-zeroes", "Medium"],
        ["sum-of-two-integers", "Medium"], ["powx-n", "Medium"]
      ]
    }
  ];

  const api = { TOPICS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
