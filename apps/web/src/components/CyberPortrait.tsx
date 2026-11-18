/** Original vector bust; inline markup also survives the single-file HTML export. */
export function CyberPortrait() {
  return <svg className="cyber-portrait-svg" viewBox="0 0 700 800" role="img" aria-label="赛博科技默认立体人物" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="cyber-coat" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ddd7e9"/><stop offset=".34" stopColor="#777087"/><stop offset=".7" stopColor="#302b3b"/><stop offset="1" stopColor="#0a0a11"/></linearGradient>
      <linearGradient id="cyber-face" x1="0" y1="0" x2="1" y2=".8"><stop stopColor="#f3d1c7"/><stop offset=".38" stopColor="#b394a3"/><stop offset=".78" stopColor="#66546e"/><stop offset="1" stopColor="#2d283d"/></linearGradient>
      <linearGradient id="cyber-hair" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#746789"/><stop offset=".28" stopColor="#2d2838"/><stop offset=".7" stopColor="#080a12"/><stop offset="1" stopColor="#706084"/></linearGradient>
      <linearGradient id="cyber-rim" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff"/><stop offset=".25" stopColor="#d8acff"/><stop offset=".65" stopColor="#7537c4"/><stop offset="1" stopColor="#1d1037"/></linearGradient>
      <radialGradient id="cyber-glow"><stop stopColor="#a353f1" stopOpacity=".8"/><stop offset="1" stopColor="#a353f1" stopOpacity="0"/></radialGradient>
      <filter id="cyber-shadow" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="25"/></filter>
    </defs>
    <ellipse cx="350" cy="540" rx="300" ry="240" fill="url(#cyber-glow)"/>
    <path d="M96 803c8-122 56-214 158-254l47-58h101l46 58c100 37 151 131 158 254Z" fill="#020309" opacity=".75" filter="url(#cyber-shadow)"/>
    <path d="M78 800c13-108 35-180 93-214 49-28 88-38 126-59l54 103 54-103c41 22 86 36 124 60 53 34 81 105 93 213Z" fill="url(#cyber-coat)" stroke="#c3a7e3" strokeWidth="4"/>
    <path d="M171 587 279 530l73 101-92 169H78c16-104 36-174 93-213Z" fill="#151322" opacity=".8"/>
    <path d="m528 587-108-57-68 101 87 169h183c-15-108-40-178-94-213Z" fill="#1b152c" opacity=".85"/>
    <path d="m282 521 70 109 66-109-21-68h-93Z" fill="url(#cyber-face)" stroke="#e4b6dc" strokeWidth="3"/>
    <path d="m269 539 83 103-72 153-41-69Z" fill="url(#cyber-rim)" opacity=".83"/>
    <path d="m435 538-83 104 72 153 43-70Z" fill="#ada5c4" opacity=".65"/>
    <path d="M210 294c0-116 63-205 147-205 103 0 165 91 155 214l-28 89c-10 77-58 150-132 155-71-2-125-74-137-152Z" fill="url(#cyber-hair)" stroke="#9b79c7" strokeWidth="4"/>
    <path d="M246 299c-2-96 40-166 111-166 76 0 118 67 114 165l-10 99c-11 70-53 121-107 123-57-3-103-58-109-126Z" fill="url(#cyber-face)"/>
    <path d="M247 314c10-24 39-41 66-43l12 11c-23 4-43 12-78 32Zm130-33c33-16 62-12 89 15l-1 17c-37-17-58-22-88-32Z" fill="#24212f" opacity=".78"/>
    <path d="M267 351c17-10 39-11 55-2m61-1c19-10 41-8 57 3" fill="none" stroke="#25202e" strokeWidth="9" strokeLinecap="round"/>
    <path d="M278 354c10 9 24 10 33 0m82-1c11 10 26 10 36 1" fill="none" stroke="#eee0e0" strokeWidth="5" strokeLinecap="round"/>
    <path d="M354 356c-4 25-9 47-15 66 11 8 23 8 36 1" fill="none" stroke="#6d5266" strokeWidth="5" strokeLinecap="round"/>
    <path d="M316 457c23 13 53 13 77-1" fill="none" stroke="#542d48" strokeWidth="6" strokeLinecap="round"/>
    <path d="M206 282c-2-121 48-215 151-224 94-8 160 74 160 197-34-14-54-57-64-104-55 64-131 90-242 99Z" fill="url(#cyber-hair)" stroke="#80669f" strokeWidth="5"/>
    <path d="M213 247c67-8 150-53 190-120" fill="none" stroke="#ded2e8" strokeOpacity=".28" strokeWidth="11" strokeLinecap="round"/>
    <path d="M261 92c-49 30-79 88-82 167m294-150c35 29 58 77 59 128" fill="none" stroke="#b57af5" strokeOpacity=".7" strokeWidth="7" strokeLinecap="round"/>
    <path d="M171 585c-42 38-67 111-77 215m433-214c48 47 70 116 80 214" fill="none" stroke="#ce9fff" strokeOpacity=".48" strokeWidth="8"/>
  </svg>;
}
