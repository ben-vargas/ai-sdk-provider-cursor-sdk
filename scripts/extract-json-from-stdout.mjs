/**
 * Pull the first complete JSON array/object out of mixed stdout.
 *
 * Older npm (Node 22 CI) prints notices/warnings before `npm pack --json`, so
 * `JSON.parse(stdout)` throws. Scan for `[` / `{`, take the matching close
 * (string-aware), and parse. If that slice is not JSON, try the next candidate
 * so a notice like `[debug]` does not hide the real payload.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function extractJsonValue(text) {
  for (let index = 0; index < text.length; index += 1) {
    const opener = text[index];
    if (opener !== '[' && opener !== '{') continue;
    try {
      const end = matchingCloseIndex(text, index);
      return JSON.parse(text.slice(index, end + 1));
    } catch {
      // Notice/warning text can contain brackets; keep scanning.
    }
  }
  throw new SyntaxError('No JSON array or object found in output');
}

/**
 * @param {string} text
 * @param {number} start
 */
function matchingCloseIndex(text, start) {
  const closers = { '[': ']', '{': '}' };
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '[' || character === '{') {
      stack.push(closers[character]);
      continue;
    }
    if (character === ']' || character === '}') {
      if (stack.pop() !== character) {
        throw new SyntaxError('Mismatched JSON brackets in output');
      }
      if (stack.length === 0) return index;
    }
  }
  throw new SyntaxError('Unterminated JSON value in output');
}
