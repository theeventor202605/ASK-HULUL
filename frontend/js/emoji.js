/**
 * HULUL - emoji library for Event Chat's compose picker (eventDetail.js, tabEventChat).
 * REQ: "Add the ability to add icon libraries, and emoji libraries for event chats." Distinct from
 * ICON_LIBRARY (icons.js) -- that one is a curated set of UI/functional glyphs used to theme the
 * app's own buttons/badges via Settings > Icons; this one is a broader set of expressive emoji for
 * writing chat messages. The chat composer's picker (see chatEmojiPopoverBody_) offers both as two
 * tabs so either "library" is one click away.
 */
window.EMOJI_LIBRARY = [
  { category: 'Smileys', emojis: [
    '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
    '😘', '😋', '😛', '😜', '🤪', '🤑', '🤗', '🤭', '🤫', '🤔', '🫡', '🤨', '😐', '😑', '😶', '😏',
    '😒', '🙄', '😬', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🥵', '🥶', '😵', '🤯',
    '🥳', '😎', '🤓', '🧐', '😕', '🙁', '😮', '😲', '🥺', '😨', '😰', '😥', '😢', '😭', '😱', '😩',
    '🥱', '😤', '😡', '😠', '🤬', '😈', '💀', '🤡'
  ] },
  { category: 'Gestures & people', emojis: [
    '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆',
    '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🙏', '✍️', '💪', '🧑',
    '🧑‍💼', '🧑‍🔧', '🧑‍✈️', '👮', '🕵️', '👷', '🫡'
  ] },
  { category: 'Hearts & symbols', emojis: [
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '💕', '💞', '💓', '💗', '💖', '💘',
    '💝', '✨', '🌟', '⭐', '💫', '🔥', '💯', '✅', '❌', '⚠️', '🚫', '❗', '❓', '💡', '🎉', '🎊'
  ] },
  { category: 'Nature & weather', emojis: [
    '🌸', '🌺', '🌻', '🌼', '🌷', '🌹', '🌱', '🌳', '🌲', '🍀', '🍁', '🍂', '🌵', '🌾', '☀️', '🌤️',
    '⛅', '☁️', '🌦️', '🌧️', '⛈️', '❄️', '☃️', '🌈', '💧', '🌊', '🌙', '🌍', '🌎', '🌏'
  ] },
  { category: 'Food & drink', emojis: [
    '🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍒', '🍑', '🥭', '🍍', '🥝', '🍅', '🥑', '🍞', '🥐',
    '🥨', '🧀', '🍗', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🍜', '🍲', '🍚', '🍣', '🍰', '🎂',
    '🍩', '🍪', '☕', '🍵', '🥤', '🧃'
  ] },
  { category: 'Activities & objects', emojis: [
    '⚽', '🏀', '🏈', '🎾', '🏆', '🎯', '🎮', '🎧', '🎬', '📷', '📱', '💻', '⌨️', '🖥️', '📞', '📅',
    '📆', '📌', '📎', '✏️', '📝', '📊', '📈', '📉', '🗂️', '📁', '📦', '🔑', '🔒', '🔓', '🛠️', '⚙️',
    '🔧', '🔨', '💰', '💳', '🎁'
  ] },
  { category: 'Travel & places', emojis: [
    '🚗', '🚕', '🚙', '🚌', '🚑', '🚒', '🚓', '🚚', '✈️', '🚀', '🚁', '⛵', '🚢', '🏢', '🏗️', '🏠',
    '🏘️', '🏟️', '🏛️', '🏥', '🏨', '🏪', '🚦', '🚧', '🗺️', '📍', '🧭'
  ] },
  { category: 'Flags', emojis: ['🏁', '🚩', '🎌', '🏳️'] }
];
