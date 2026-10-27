(function (root) {
  function createTokenizer(aliases = {}, entries = []) {
    const custom = new Map(entries.map((entry) => [entry.text, entry]));
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tokens = [...custom.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
    const pattern = new RegExp(
      tokens.map(escape).concat(":[A-Za-z0-9_+\\-]+:").join("|"), "g",
    );
    return function tokenize(text) {
      const runs = [];
      let cursor = 0;
      const append = (value) => {
        if (!value) return;
        if (runs.at(-1)?.type === "text") runs.at(-1).text += value;
        else runs.push({ type: "text", text: value });
      };
      for (const match of text.matchAll(pattern)) {
        append(text.slice(cursor, match.index));
        const entry = custom.get(match[0]);
        if (entry) runs.push({ type: "image", text: match[0], id: entry.id });
        else {
          const name = match[0].slice(1, -1);
          append(Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : match[0]);
        }
        cursor = match.index + match[0].length;
      }
      append(text.slice(cursor));
      return runs;
    };
  }
  const api = { createTokenizer };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EmojiText = api;
})(globalThis);
