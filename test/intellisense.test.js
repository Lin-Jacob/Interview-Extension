const test = require("node:test");
const assert = require("node:assert");
const { complete, score } = require("../lib/intellisense.js");

// Completes at the end of the last line of `code`.
function at(code, lang) {
  const lines = code.split("\n");
  return complete({ code, lineNo: lines.length - 1, col: lines[lines.length - 1].length, lang }).items.map((i) => i.word);
}

test("python: members of LeetCode's commented-out TreeNode, through a chain", () => {
  const head = `# Definition for a binary tree node.
# class TreeNode:
#     def __init__(self, val=0, left=None, right=None):
#         self.val = val
#         self.left = left
#         self.right = right
class Solution:
    def maxDepth(self, root: Optional[TreeNode]) -> int:
`;
  assert.deepStrictEqual(at(head + "        root.", "python").sort(), ["left", "right", "val"]);
  assert.deepStrictEqual(at(head + "        root.left.r", "python"), ["right"]);
});

test("python: self members of a user class, builtin types, modules", () => {
  const cls = `class LRUCache:
    def __init__(self, capacity: int):
        self.cap = capacity
        self.cache = {}
        self.order = collections.deque()

    def get(self, key: int) -> int:
        `;
  const self = at(cls + "self.", "python");
  assert.ok(["cap", "cache", "order", "get"].every((w) => self.includes(w)), self.join());
  assert.ok(!self.includes("__init__"));
  assert.deepStrictEqual(at(cls + "self.order.popl", "python"), ["popleft"]);
  assert.ok(at(cls + "self.cache.", "python").includes("setdefault"));
  assert.deepStrictEqual(at("heapq.heappu", "python"), ["heappush", "heappushpop"]);
  assert.ok(at("seen = set()\nseen.", "python").includes("add"));
  assert.ok(at("ans = []\nans.app", "python")[0] === "append");
  assert.ok(at("s = 'abc'\ns.st", "python").includes("startswith"));
});

test("python: locals and fuzzy matches without a dot", () => {
  const code = `def f(self, nums: List[int], target: int):
    left, right = 0, len(nums) - 1
    best_so_far = 0
    `;
  assert.strictEqual(at(code + "ta", "python")[0], "target");
  assert.ok(at(code + "bsf", "python").includes("best_so_far"), "underscore initials match");
  assert.ok(at(code + "ri", "python").includes("right"));
  assert.ok(at(code + "ret", "python").includes("return"));
});

test("java: generics, aliases, user classes and this", () => {
  const code = `/**
 * public class ListNode {
 *     int val;
 *     ListNode next;
 * }
 */
class Solution {
    private Map<Integer, Integer> memo = new HashMap<>();
    public ListNode reverse(ListNode head) {
        Deque<Integer> stack = new ArrayDeque<>();
        StringBuilder sb = new StringBuilder();
        `;
  assert.ok(at(code + "memo.getO", "java")[0] === "getOrDefault");
  assert.ok(at(code + "stack.pee", "java").includes("peekFirst"));
  assert.ok(at(code + "head.", "java").includes("next"));
  assert.ok(at(code + "head.next.", "java").includes("val"));
  assert.ok(at(code + "sb.app", "java")[0] === "append");
  assert.ok(at(code + "this.", "java").includes("memo"));
});

test("cpp: STL members, pointers with ->, struct fields", () => {
  const code = `struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
};
class Solution {
public:
    int f(TreeNode* root, vector<int>& nums) {
        unordered_map<int, int> cnt;
        `;
  assert.ok(at(code + "root->", "cpp").includes("left"));
  assert.ok(at(code + "root->left->v", "cpp")[0] === "val");
  assert.ok(at(code + "nums.push", "cpp")[0] === "push_back");
  assert.ok(at(code + "cnt.co", "cpp").includes("count"));
});

test("javascript: Map/Set/Array/String and jsdoc params", () => {
  const code = `/**
 * @param {number[]} nums
 * @param {string} s
 */
var f = function(nums, s) {
    const seen = new Map();
    `;
  assert.ok(at(code + "seen.ha", "javascript")[0] === "has");
  assert.ok(at(code + "nums.inc", "javascript")[0] === "includes");
  assert.ok(at(code + "s.char", "javascript").includes("charAt"));
});

test("sql: schema words after a table alias, keywords otherwise", () => {
  const r = complete({ code: "SELECT e.", lineNo: 0, col: 9, lang: "sql", extra: ["Employee", "id", "name", "salary"] });
  assert.ok(["id", "name", "salary"].every((w) => r.items.map((i) => i.word).includes(w)));
  const k = complete({ code: "SELECT name FR", lineNo: 0, col: 14, lang: "sql", extra: [] });
  assert.strictEqual(k.items[0].word, "FROM");
});

test("ranking prefers exact-case prefixes, then initials, then subsequences", () => {
  assert.ok(score("getOrDefault", "get") > score("getOrDefault", "gOD"));
  assert.ok(score("getOrDefault", "gOD") > score("getOrDefault", "gtd"));
  assert.strictEqual(score("append", "x"), null);
  assert.ok(score("append", "append") > 0);
});

test("python: element types flow from containers (queue of TreeNode -> node)", () => {
  const head = `# class TreeNode:
#     def __init__(self, val=0, left=None, right=None):
#         self.val = val
#         self.left = left
#         self.right = right
class Solution:
    def levels(self, root: Optional[TreeNode], extra: List[ListNode]) -> int:
        queue = collections.deque([root])
        while queue:
            node = queue.popleft()
`;
  assert.deepStrictEqual(at(head + "            node.", "python").sort(), ["left", "right", "val"]);
  assert.deepStrictEqual(at(head + "            for e in extra:\n                e.", "python").sort(), ["next", "val"]);
  assert.ok(at("x = deque()\nx.pop", "python").includes("pop"), "exact member still listed");
  assert.ok(!at("def f():\n    -> int\n    q.", "python").includes("int"));
});

test("cpp/java: element types from generics (auto node = q.front())", () => {
  const cpp = `struct TreeNode { int val; TreeNode *left; TreeNode *right; };
class Solution {
public:
    void f(TreeNode* root) {
        queue<TreeNode*> q;
        auto node = q.front();
        `;
  assert.ok(at(cpp + "node->", "cpp").includes("left"));
  const java = `class Solution {
    void f(List<ListNode> lists) {
        for (var head : lists) {
            `;
  assert.ok(at(java + "head.", "java").includes("next"));
});
