/**
 * Emoji support for markdown surfaces (owner request): `:shortcode:` and
 * common ASCII emoticons render as unicode emoji in the read-only viewers
 * (comments, card description). The stored markdown keeps the raw text —
 * the conversion is display-only, so editing a comment round-trips.
 *
 * Code is left alone: fenced blocks and inline spans never emojify, and a
 * `:/` inside `https://` stays a URL because emoticons need a leading
 * boundary (start of line or whitespace).
 */

/** GitHub-style shortcodes → emoji (a practical common subset). */
const SHORTCODES: Record<string, string> = {
  "+1": "👍",
  "-1": "👎",
  100: "💯",
  angel: "👼",
  angry: "😠",
  applaud: "👏",
  arrow_down: "⬇️",
  arrow_up: "⬆️",
  bell: "🔔",
  bug: "🐛",
  bulb: "💡",
  cake: "🎂",
  calendar: "📅",
  cat: "🐱",
  check: "✅",
  clap: "👏",
  clock: "🕐",
  coffee: "☕",
  computer: "💻",
  confused: "😕",
  cry: "😢",
  dog: "🐶",
  dizzy: "💫",
  dollar: "💵",
  droplet: "💧",
  egg: "🥚",
  email: "📧",
  eyes: "👀",
  facepalm: "🤦",
  fax: "📠",
  fire: "🔥",
  flashlight: "🔦",
  gift: "🎁",
  grin: "😁",
  hammer: "🔨",
  hammer_and_wrench: "🛠️",
  hand: "✋",
  heart: "❤️",
  hmm: "🤔",
  hospital: "🏥",
  hourglass: "⌛",
  idea: "💡",
  imp: "😈",
  joy: "😂",
  key: "🔑",
  laugh: "😆",
  led: "🔦",
  link: "🔗",
  lock: "🔒",
  lock_with_key: "🔐",
  loudspeaker: "📢",
  mag: "🔍",
  mailbox: "📬",
  memo: "📝",
  memo_2: "🗒️",
  mega: "📣",
  medal: "🏅",
  money: "💰",
  monkey: "🐵",
  moon: "🌙",
  muscle: "💪",
  musical_note: "🎵",
  nail_care: "💅",
  necktie: "👔",
  nerd: "🤓",
  no_entry: "⛔",
  notebook: "📓",
  ok: "🆗",
  ok_hand: "👌",
  open_file: "📂",
  package: "📦",
  page_facing_up: "📄",
  paperclip: "📎",
  party: "🥳",
  pencil: "✏️",
  phone: "📱",
  pig: "🐷",
  pill: "💊",
  pizza: "🍕",
  point_down: "👇",
  point_left: "👈",
  point_right: "👉",
  point_up: "👆",
  poop: "💩",
  pray: "🙏",
  question: "❓",
  rocket: "🚀",
  rotfl: "🤣",
  salt: "🧂",
  scared: "😨",
  scream: "😱",
  shake: "🫨",
  shirt: "👕",
  skull: "💀",
  sleeping: "😴",
  sleepy: "😪",
  smile: "😄",
  smiley: "🙂",
  slightly_smiling_face: "🙂",
  slightly_frowning_face: "🙁",
  smirk: "😏",
  snowflake: "❄️",
  sparkles: "✨",
  star: "⭐",
  star2: "🌟",
  sunglasses: "😎",
  sun: "☀️",
  sunny: "🌞",
  sweat: "😓",
  thumbsdown: "👎",
  thumbsup: "👍",
  thunder: "⚡",
  tada: "🎉",
  thinking: "🤔",
  thumbs_up: "👍",
  thumbs_down: "👎",
  timer: "⏱️",
  tongue: "😛",
  trophy: "🏆",
  truck: "🚚",
  umbrella: "☔",
  unicorn: "🦄",
  unamused: "😒",
  up: "🆙",
  warning: "⚠️",
  wave: "👋",
  wavy_dash: "〰️",
  weary: "😩",
  wink: "😉",
  wrench: "🔧",
  x: "❌",
  yay: "🙌",
  yin_yang: "☯️",
  zany: "🤪",
  zap: "⚡",
  zipper_mouth: "🤐",
};

/** ASCII emoticons → emoji, longest first so `:-)` beats `:)`. */
const EMOTICONS: [string, string][] = [
  [":-)", "🙂"],
  [":)", "🙂"],
  [":-(", "🙁"],
  [":(", "🙁"],
  [":'(", "😢"],
  [":-D", "😄"],
  [":D", "😄"],
  [";-)", "😉"],
  [";)", "😉"],
  [":-P", "😛"],
  [":P", "😛"],
  [";P", "😜"],
  ["xD", "🤣"],
  ["XD", "🤣"],
  [":-o", "😮"],
  [":o", "😮"],
  [":O", "😮"],
  [":-/", "😕"],
  [":/", "😕"],
  [":-|", "😐"],
  [":|", "😐"],
  ["8)", "😎"],
  ["B)", "😎"],
  ["<3", "❤️"],
  [">:(", "😠"],
];

const SHORTCODE_RE = /:([a-z0-9_+-]+):/gi;

/**
 * Emoticon matchers compiled once at module load instead of rebuilt on every
 * `emojify()` call (which runs on each markdown render). `String.replace`
 * resets a global regex's `lastIndex`, so sharing these across calls is safe.
 */
const EMOTICON_RES: { re: RegExp; emoji: string }[] = EMOTICONS.map(
  ([face, emoji]) => {
    const escaped = face.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Lookbehind for a boundary; `xD`/`XD` are the only case-sensitive ones.
    const flags = face === "xD" || face === "XD" ? "gu" : "giu";
    return { re: new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, flags), emoji };
  },
);

/** Replace `:shortcode:` tokens; unknown names stay untouched. */
function emojifyShortcodes(text: string): string {
  return text.replace(SHORTCODE_RE, (whole, name: string) => {
    const emoji = SHORTCODES[name.toLowerCase()];
    return emoji ?? whole;
  });
}

/** Replace emoticons that start at a boundary (line start or whitespace). */
function emojifyEmoticons(text: string): string {
  let result = text;
  for (const { re, emoji } of EMOTICON_RES) {
    result = result.replace(re, emoji);
  }
  return result;
}

/** True for emoji-able text: outside code fences and inline code spans. */
function emojifySegment(text: string): string {
  return emojifyEmoticons(emojifyShortcodes(text));
}

/**
 * Convert shortcodes and emoticons to emoji, skipping fenced code blocks
 * and inline code spans so code samples survive untouched.
 */
export function emojify(markdown: string): string {
  if (
    !markdown.includes(":") &&
    !/<3|:\)|:\(|\bd\b|;|\bp\b|8\)|b\)/i.test(markdown)
  ) {
    return markdown;
  }
  // Split on fenced blocks first, then inline code inside the rest.
  return markdown
    .split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/g)
    .map((chunk) =>
      chunk.startsWith("```") || chunk.startsWith("~~~")
        ? chunk
        : chunk
            .split(/(`[^`\n]*`)/g)
            .map((part) => (part.startsWith("`") ? part : emojifySegment(part)))
            .join(""),
    )
    .join("");
}
