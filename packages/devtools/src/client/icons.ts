const SVG_NS = "http://www.w3.org/2000/svg";

/** 24×24 line icons, drawn with currentColor so they follow the text colour of their container. */
const ICON_PATHS = {
  bridge: ["M4 8h14", "M15 5l3 3-3 3", "M20 16H6", "M9 13l-3 3 3 3"],
  console: [
    "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z",
    "M8 9.5l2.5 2.5L8 14.5",
    "M13 15h3",
  ],
  network: ["M8 20V4", "M4.5 7.5L8 4l3.5 3.5", "M16 4v16", "M12.5 16.5L16 20l3.5-3.5"],
  plugins: ["M4.5 4.5h6v6h-6z", "M13.5 4.5h6v6h-6z", "M4.5 13.5h6v6h-6z", "M13.5 13.5h6v6h-6z"],
  clients: [
    "M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z",
    "M11 17.5h2",
  ],
  reload: ["M19.5 12a7.5 7.5 0 1 1-2.2-5.3", "M19.5 4.5v4h-4"],
  clear: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M6 6l12 12"],
  pause: ["M9 5.5v13", "M15 5.5v13"],
  play: ["M8 5.5v13l10.5-6.5z"],
  search: ["M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", "M15.5 15.5L20 20"],
  close: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
  copy: ["M9 9h10.5v10.5H9z", "M5 15V4.5h10.5"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  chevron: ["M9.5 6.5L15 12l-5.5 5.5"],
  moon: ["M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"],
  sun: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    "M12 2.5v2",
    "M12 19.5v2",
    "M4.5 12h-2",
    "M21.5 12h-2",
    "M5.3 5.3l1.4 1.4",
    "M17.3 17.3l1.4 1.4",
    "M5.3 18.7l1.4-1.4",
    "M17.3 6.7l1.4-1.4",
  ],
  error: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M9 9l6 6", "M15 9l-6 6"],
  warn: ["M12 4l9 15.5H3z", "M12 10v4", "M12 16.8v.2"],
  info: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M12 11v5", "M12 8v.2"],
  empty: ["M4 13.5l2.5-8h11l2.5 8", "M4 13.5V19h16v-5.5", "M4 13.5h4.5l1 2h5l1-2H20"],
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function icon(name: IconName, className = "wd-icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * The full Wefter logo (mark + wordmark), path data copied from Docs/Logo/{Dark,Light}/Logo.svg.
 * The gradient stops are themed in CSS: the Dark file's colours on dark, the Light file's on light.
 */
const LOGO_GROUPS: { transform: string; paths: { d: string; evenOdd: boolean }[] }[] = [
  {
    transform: "translate(-270 -97)",
    paths: [
      {
        d: "M823.2 612.1 c-22.9 -14.6 -43.9 -28.8 -61.1 -41.3 -17.4 -12.7 -43.8 -33.6 -43.8 -34.6 0 -0.5 2.8 -3.4 6.1 -6.3 6.1 -5.3 24 -24.1 30.4 -31.9 l3.3 -4 11.6 9.2 c18.5 14.7 38 29 45.5 33.4 0.7 0.5 2 -1.5 3.7 -5.7 2.6 -6.5 20.1 -49.7 66.2 -163.9 43.2 -106.8 47.1 -116.5 47.1 -117.4 0 -0.9 -22 -0.9 -25.4 0 -2.3 0.7 -5.7 7.7 -22.9 45.7 -12.6 28 -42.1 91.6 -43.1 93.1 -1.3 1.7 0 3.9 -24.4 -39.7 l-10.8 -19.4 2.8 -5.7 c1.5 -3.2 12.1 -26 23.3 -50.8 11.3 -24.8 24.5 -53.5 29.3 -64 l8.7 -18.9 73.2 -0.3 73.2 -0.2 -1.3 3.8 c-2.5 6.9 -29.5 75.7 -50.8 129.2 -7.7 19.4 -27 68.3 -43 108.5 -16 40.2 -39.8 100.4 -53.1 133.7 l-24.1 60.6 -20.5 -13z",
        evenOdd: false,
      },
      {
        d: "M570.3 619.4 c-3.1 -7.1 -25.6 -64.2 -34 -85.7 l-7.1 -18.4 6.4 -12.3 c25.8 -49.1 64.9 -122.3 86.2 -161.2 36.2 -66.4 78.2 -142 83.3 -150.2 0.7 -1.2 1.8 -2.3 2.5 -2.3 1.1 0 1.9 1.5 49.3 84.9 36 63.3 58.8 103.9 75.5 133.6 l11.6 20.7 -12.6 31 c-6.9 17.1 -13.1 32.3 -13.8 33.9 l-1.3 2.9 -3.6 -5.9 c-8.1 -13.3 -70.2 -123 -92.3 -162.9 -5.8 -10.4 -10.6 -19.1 -10.8 -19.2 -0.1 -0.2 -1.2 -0.1 -2.4 0.3 -1.3 0.4 -4.7 5.4 -9.4 14.1 -10.4 19.1 -23.1 42.5 -47.6 87.2 -11.7 21.4 -29.4 54 -39.3 72.4 l-18.2 33.6 3.7 9.4 c1.9 5.2 3.9 9.8 4.4 10.3 1.6 1.8 33.5 -21.7 57.4 -42.5 28.1 -24.5 59.6 -61.1 76.4 -89.1 2.6 -4.4 5.2 -7.9 5.7 -8 0.6 0 8.1 12.3 16.6 27.2 l15.6 27.1 -5.2 7.4 c-40.9 57.6 -87.5 99.1 -170.9 152.1 -11.6 7.4 -21.8 13.6 -22.6 13.9 -1 0.4 -2 -0.9 -3.5 -4.3z",
        evenOdd: false,
      },
      {
        d: "M519.5 491.9 c-11.9 -27.5 -118.4 -298.5 -118.4 -301 0 -1.3 8.4 -1.5 72.5 -1.5 l72.4 0 14.6 31.9 c19 41.5 31.4 68.5 39.6 86.3 3.7 7.9 7.6 16.2 8.5 18.5 l1.8 4.2 -16.5 30.3 c-9.1 16.8 -17 30.3 -17.5 30.1 -0.9 -0.3 -12.5 -25.3 -43 -92.3 -6.7 -14.6 -14.5 -31.8 -17.6 -38.2 l-5.4 -11.5 -13.3 0 c-8.2 0 -13.4 0.4 -13.4 1 0 0.5 16.4 41.7 36.3 91.6 l36.4 90.6 -7.9 15.1 c-13.6 26.1 -26.3 49.3 -26.9 49.3 -0.3 0 -1.4 -1.9 -2.5 -4.4z",
        evenOdd: false,
      },
      {
        d: "M650.5 463.1 l-7 -9.7 13 -23.3 c7.2 -12.8 14.2 -25.5 15.7 -28.1 1.4 -2.7 3.1 -4.9 3.5 -4.9 0.7 0 19.7 28.3 20.8 31.1 0.3 0.7 -2.8 5.4 -6.8 10.4 -7.8 9.7 -30.4 34.2 -31.6 34.2 -0.4 0 -3.8 -4.4 -7.6 -9.6z",
        evenOdd: false,
      },
    ],
  },
  {
    transform: "translate(730 528.2) scale(0.25 -0.25)",
    paths: [
      {
        d: "M454 1216 V843 H938 V616 H454 V235 H1076 V0 H152 V1451 H1076 V1216 Z",
        evenOdd: false,
      },
      {
        d: "M1602 1216 V815 H2124 V579 H1602 V0 H1300 V1451 H2224 V1216 Z",
        evenOdd: false,
      },
      {
        d: "M3459 1209 H3035 V0 H2734 V1209 H2310 V1451 H3459 Z",
        evenOdd: false,
      },
      {
        d: "M3942 1216 V843 H4426 V616 H3942 V235 H4564 V0 H3640 V1451 H4564 V1216 Z",
        evenOdd: false,
      },
      {
        d: "M5242 764 Q5315 764 5368 782.5 Q5421 801 5455 833.5 Q5489 866 5505 910 Q5521 954 5521 1006 Q5521 1109 5452.5 1166 Q5384 1223 5244 1223 H5088 V764 Z M5945 0 H5674 Q5598 0 5564 58 L5288 503 Q5271 529 5250.5 541 Q5230 553 5190 553 H5088 V0 H4788 V1451 H5244 Q5396 1451 5504 1419.5 Q5612 1388 5681 1332 Q5750 1276 5782 1198.5 Q5814 1121 5814 1028 Q5814 956 5793.5 891.5 Q5773 827 5734 774 Q5695 721 5638 680 Q5581 639 5508 614 Q5537 598 5562 575.5 Q5587 553 5607 522 Z",
        evenOdd: true,
      },
    ],
  },
];

export function wefterLogo(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  // Tight bounding box of the artwork inside the original 2360×620 canvas.
  svg.setAttribute("viewBox", "131 92 2086 437");
  svg.setAttribute("class", "wd-logo");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Wefter");
  const defs = document.createElementNS(SVG_NS, "defs");
  const gradient = document.createElementNS(SVG_NS, "linearGradient");
  gradient.setAttribute("id", "wd-logo-gradient");
  gradient.setAttribute("x1", "0%");
  gradient.setAttribute("y1", "0%");
  gradient.setAttribute("x2", "100%");
  gradient.setAttribute("y2", "100%");
  for (const [offset, cls] of [
    ["0%", "wd-logo-stop-a"],
    ["100%", "wd-logo-stop-b"],
  ]) {
    const stop = document.createElementNS(SVG_NS, "stop");
    stop.setAttribute("offset", offset!);
    stop.setAttribute("class", cls!);
    gradient.appendChild(stop);
  }
  defs.appendChild(gradient);
  svg.appendChild(defs);
  const fill = document.createElementNS(SVG_NS, "g");
  fill.setAttribute("fill", "url(#wd-logo-gradient)");
  for (const group of LOGO_GROUPS) {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", group.transform);
    for (const { d, evenOdd } of group.paths) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      if (evenOdd) path.setAttribute("fill-rule", "evenodd");
      g.appendChild(path);
    }
    fill.appendChild(g);
  }
  svg.appendChild(fill);
  return svg;
}
