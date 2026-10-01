// Iconos SVG en línea (trazo de 1.75 px, estilo lucide).

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

const icon = (paths: React.ReactNode) =>
  function Icon({ size, ...rest }: P) {
    return (
      <svg {...base(size)} {...rest} aria-hidden="true">
        {paths}
      </svg>
    );
  };

export const IconPlay = icon(<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />);
export const IconStop = icon(<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />);
export const IconReset = icon(<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>);
export const IconNew = icon(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M12 12v6M9 15h6" /></>);
export const IconSave = icon(<><path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M7 3v5h8M7 21v-7h10v7" /></>);
export const IconFolder = icon(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
export const IconTrash = icon(<><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>);
export const IconBroom = icon(<><path d="M19 3 9.5 12.5" /><path d="M5 14c2-2 5-2 6 0l1 1c2 1 2 4 0 6H3c0-3 0-5 2-7z" /></>);
export const IconUndo = icon(<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>);
export const IconRedo = icon(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>);
export const IconCode = icon(<><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /></>);
export const IconCircuit = icon(<><rect x="7" y="7" width="10" height="10" rx="1" /><path d="M10 7V3M14 7V3M10 21v-4M14 21v-4M7 10H3M7 14H3M21 10h-4M21 14h-4" /></>);
export const IconSplit = icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>);
export const IconSwap = icon(<><path d="M7 7h13l-3-3M17 17H4l3 3" /></>);
export const IconMax = icon(<><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>);
export const IconMin = icon(<><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></>);
export const IconZoomIn = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M11 8v6M8 11h6" /></>);
export const IconZoomOut = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8 11h6" /></>);
export const IconFit = icon(<><path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5" /><rect x="8" y="8" width="8" height="8" rx="1" /></>);
export const IconRotate = icon(<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>);
export const IconSound = icon(<><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></>);
export const IconMute = icon(<><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 5 6M21 9l-5 6" /></>);
export const IconDownload = icon(<><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></>);
export const IconUpload = icon(<><path d="M12 21V9M7 14l5-5 5 5M4 3h16" /></>);
export const IconBook = icon(<><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 19.5V4.5" /></>);
export const IconAlert = icon(<><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>);
export const IconError = icon(<><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></>);
export const IconInfo = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const IconCheck = icon(<path d="m5 12 5 5 9-10" />);
export const IconClose = icon(<path d="M6 6l12 12M18 6 6 18" />);
export const IconSend = icon(<path d="M4 12 20 4l-6 16-3-7z" />);
export const IconHelp = icon(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" /></>);
export const IconSun = icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = icon(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);
export const IconChevron = icon(<path d="m6 9 6 6 6-6" />);
export const IconSearch = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconCopy = icon(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>);
